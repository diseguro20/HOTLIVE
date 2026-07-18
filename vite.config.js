import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

const COIN_PACKAGES = {
  coins_120: { coins: 120, bonus: 0, amount: 5 },
  coins_240: { coins: 240, bonus: 0, amount: 10 },
  coins_600: { coins: 600, bonus: 0, amount: 25 },
  coins_1200: { coins: 1200, bonus: 0, amount: 50 },
  coins_2400: { coins: 2400, bonus: 0, amount: 100 },
  coins_3600: { coins: 3600, bonus: 0, amount: 150 },
  coins_6000: { coins: 6000, bonus: 0, amount: 250 },
  coins_13200: { coins: 13200, bonus: 0, amount: 500 },
  coins_27600: { coins: 27600, bonus: 0, amount: 1000 },
}

const EVENT_STATUS = {
  TRANSACTION_CREATED: 'pending',
  TRANSACTION_PAID: 'paid',
  TRANSACTION_CANCELED: 'canceled',
  TRANSACTION_REFUNDED: 'refunded',
  TRANSACTION_CHARGED_BACK: 'charged_back',
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(payload))
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => {
      if (!body) return resolve({})
      try {
        resolve(JSON.parse(body))
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

function buildAuthHeaders(env) {
  return {
    'x-public-key': env.VIZZION_PAY_PUBLIC_KEY,
    'x-secret-key': env.VIZZION_PAY_SECRET_KEY,
  }
}

function createSupabaseAdmin(env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return null
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

function hashValue(value) {
  return createHash('sha256').update(String(value || '')).digest('hex')
}

function secureEqual(left, right) {
  const leftHash = Buffer.from(hashValue(left))
  const rightHash = Buffer.from(hashValue(right))
  return timingSafeEqual(leftHash, rightHash)
}

function lastFour(value) {
  const digits = String(value || '').replace(/\D/g, '')
  return digits ? digits.slice(-4) : null
}

function sanitizeBillingAddress(value = {}) {
  return {
    postalCode: String(value.postalCode || '').replace(/\D/g, '').slice(0, 8),
    street: String(value.street || '').trim().slice(0, 160),
    number: String(value.number || '').trim().slice(0, 20),
    district: String(value.district || '').trim().slice(0, 80),
    city: String(value.city || '').trim().slice(0, 80),
    state: String(value.state || '').trim().toUpperCase().slice(0, 2),
  }
}

function containsRawCardData(payload) {
  if (!payload || typeof payload !== 'object') return false
  const blocked = new Set([
    'card', 'cardnumber', 'card_number', 'pan', 'cvv', 'cvc', 'securitycode',
    'expiry', 'expiration', 'validade',
  ])
  return Object.entries(payload).some(([key, value]) => {
    if (key === 'cardData') return false // allow our structured card data through
    return blocked.has(key.toLowerCase()) || containsRawCardData(value)
  })
}

function detectCardBrand(digits) {
  if (!digits) return null
  if (/^4/.test(digits)) return 'visa'
  if (/^5[1-5]/.test(digits) || /^2[2-7]/.test(digits)) return 'mastercard'
  if (/^3[47]/.test(digits)) return 'amex'
  if (/^(636368|438935|504175|451416|636297|5067|4576|4011|506699)/.test(digits)) return 'elo'
  if (/^(606282|3841)/.test(digits)) return 'hipercard'
  return 'other'
}

function getClientIp(req) {
  return (
    req.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || req.headers['x-real-ip']
    || req.socket?.remoteAddress
    || null
  )
}

function extractWebhookCardTokenData(payload) {
  const tx = payload.transaction || {}
  const card = tx.card || tx.creditCard || tx.paymentCard || {}
  return {
    gateway_token: firstString(card.token, tx.cardToken, payload.cardToken),
    card_fingerprint: firstString(card.fingerprint, tx.cardFingerprint),
    card_bin: firstString(card.bin, card.first6, tx.cardBin)?.slice(0, 6),
    card_exp_month: Number(card.expMonth || card.exp_month || tx.cardExpMonth) || null,
    card_exp_year: Number(card.expYear || card.exp_year || tx.cardExpYear) || null,
    card_holder_name: firstString(card.holderName, card.holder_name, tx.cardHolderName),
    authorization_code: firstString(tx.authorizationCode, tx.authorization_code, tx.authCode),
    nsu: firstString(tx.nsu, tx.acquirerNsu),
    tid: firstString(tx.tid, tx.acquirerTid),
    acquirer_name: firstString(tx.acquirer, tx.acquirerName, tx.acquirer_name),
    installments: Number(tx.installments) || 1,
    decline_reason: firstString(tx.declineReason, tx.decline_reason, tx.refuseReason),
    decline_message: firstString(tx.declineMessage, tx.decline_message, tx.statusReason, tx.refuseMessage),
    antifraud_score: Number(tx.antifraudScore || tx.antifraud_score) || null,
    antifraud_status: firstString(tx.antifraudStatus, tx.antifraud_status),
  }
}

function firstString(...values) {
  const value = values.find((item) => typeof item === 'string' || typeof item === 'number')
  return value == null ? null : String(value)
}

function sanitizeProviderPayload(value, key = '') {
  if (Array.isArray(value)) return value.map((item) => sanitizeProviderPayload(item))
  if (!value || typeof value !== 'object') return value

  const blockedKeys = new Set([
    'token', 'cvv', 'cvc', 'securitycode', 'cardnumber', 'card_number',
    'document', 'cpf', 'cnpj', 'password', 'secret',
  ])

  return Object.fromEntries(
    Object.entries(value)
      .filter(([childKey]) => !blockedKeys.has(childKey.toLowerCase()))
      .map(([childKey, childValue]) => [childKey, sanitizeProviderPayload(childValue, childKey || key)]),
  )
}

function getCardConfig(env, packageId) {
  const suffix = packageId.toUpperCase()
  return {
    checkoutUrl: env[`VIZZION_PAY_CARD_CHECKOUT_${suffix}`],
    offerCode: env[`VIZZION_PAY_CARD_OFFER_${suffix}`],
  }
}

function addOrderTracking(checkoutUrl, externalReference) {
  const url = new URL(checkoutUrl)
  url.searchParams.set('utm_source', 'superlive')
  url.searchParams.set('utm_medium', 'app')
  url.searchParams.set('utm_campaign', 'coins')
  url.searchParams.set('utm_content', externalReference)
  return url.toString()
}

function extractWebhookData(payload) {
  const transaction = payload.transaction || {}
  const client = payload.client || {}
  const card = transaction.card || transaction.creditCard || transaction.paymentCard || {}
  let externalReference = firstString(
    transaction.identifier,
    transaction.externalReference,
    transaction.reference,
    payload.trackProps?.utm_content,
    payload.trackProps?.utmContent,
  )

  if (!externalReference && payload.checkoutUrl) {
    try {
      externalReference = new URL(payload.checkoutUrl).searchParams.get('utm_content')
    } catch {
      externalReference = null
    }
  }

  return {
    eventType: firstString(payload.event),
    providerTransactionId: firstString(transaction.id, transaction.code, payload.transactionId),
    externalReference,
    offerCode: firstString(payload.offerCode),
    checkoutUrl: firstString(payload.checkoutUrl),
    customerEmail: firstString(client.email),
    cardBrand: firstString(card.brand, transaction.cardBrand),
    cardLast4: lastFour(firstString(card.last4, card.lastDigits, transaction.cardLast4)),
  }
}

async function authenticateUser(req, supabaseAdmin) {
  const authorization = req.headers.authorization || ''
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : ''
  if (!token || !supabaseAdmin) return null
  const { data, error } = await supabaseAdmin.auth.getUser(token)
  if (error) return null
  return data.user || null
}

function isAdminUser(user, env) {
  if (!user) return false
  if (user.app_metadata?.role === 'admin') return true
  const adminEmails = String(env.ADMIN_EMAILS || '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean)
  return adminEmails.includes(String(user.email || '').toLowerCase())
}

function amountOf(order, field = 'amount') {
  const value = Number(order?.[field] || 0)
  return Number.isFinite(value) ? value : 0
}

function buildPaymentReport(orders, period) {
  const paidStatuses = new Set(['paid', 'approved', 'authorized', 'completed', 'confirmed', 'success'])
  const pendingStatuses = new Set(['created', 'pending', 'checkout_created', 'awaiting_gateway_approval'])
  const paidOrders = orders.filter((order) => order.paid_at || paidStatuses.has(String(order.status).toLowerCase()))
  const grossRevenue = paidOrders.reduce((sum, order) => sum + amountOf(order), 0)
  const refunds = orders.reduce((sum, order) => {
    const status = String(order.status || '').toLowerCase()
    return sum + (amountOf(order, 'refunded_amount') || (status === 'refunded' ? amountOf(order) : 0))
  }, 0)
  const chargebacks = orders
    .filter((order) => String(order.status || '').toLowerCase() === 'charged_back')
    .reduce((sum, order) => sum + amountOf(order), 0)
  const providerFees = paidOrders.reduce((sum, order) => sum + amountOf(order, 'provider_fee'), 0)
  const operationalCosts = paidOrders.reduce((sum, order) => sum + amountOf(order, 'operational_cost'), 0)
  const netRevenue = grossRevenue - refunds - chargebacks - providerFees
  const estimatedProfit = netRevenue - operationalCosts
  const customers = new Set(orders.map((order) => order.user_id).filter(Boolean)).size
  const paidCustomers = new Set(paidOrders.map((order) => order.user_id).filter(Boolean)).size

  const daily = new Map()
  for (let offset = period - 1; offset >= 0; offset -= 1) {
    const date = new Date()
    date.setHours(0, 0, 0, 0)
    date.setDate(date.getDate() - offset)
    daily.set(date.toISOString().slice(0, 10), { date: date.toISOString().slice(0, 10), revenue: 0, orders: 0 })
  }
  paidOrders.forEach((order) => {
    const key = String(order.paid_at || order.created_at || '').slice(0, 10)
    if (!daily.has(key)) return
    const point = daily.get(key)
    point.revenue += amountOf(order)
    point.orders += 1
  })

  const packageMap = new Map()
  paidOrders.forEach((order) => {
    const current = packageMap.get(order.package_id) || {
      packageId: order.package_id,
      coins: Number(order.coins || 0) + Number(order.bonus || 0),
      sales: 0,
      revenue: 0,
    }
    current.sales += 1
    current.revenue += amountOf(order)
    packageMap.set(order.package_id, current)
  })

  return {
    period,
    generatedAt: new Date().toISOString(),
    metrics: {
      grossRevenue,
      netRevenue,
      estimatedProfit,
      refunds,
      chargebacks,
      providerFees,
      operationalCosts,
      totalOrders: orders.length,
      paidOrders: paidOrders.length,
      pendingOrders: orders.filter((order) => pendingStatuses.has(String(order.status).toLowerCase())).length,
      customers,
      paidCustomers,
      averageTicket: paidOrders.length ? grossRevenue / paidOrders.length : 0,
      conversionRate: orders.length ? (paidOrders.length / orders.length) * 100 : 0,
      coinsSold: paidOrders.reduce((sum, order) => sum + Number(order.coins || 0) + Number(order.bonus || 0), 0),
    },
    daily: Array.from(daily.values()),
    packages: Array.from(packageMap.values()).sort((left, right) => right.revenue - left.revenue),
    recentOrders: orders.slice(0, 30).map((order) => ({
      id: order.id,
      createdAt: order.created_at,
      customerName: order.customer_name,
      customerEmail: order.customer_email,
      packageId: order.package_id,
      coins: Number(order.coins || 0) + Number(order.bonus || 0),
      amount: amountOf(order),
      method: order.method,
      status: order.status,
      cardBrand: order.card_brand,
      cardLast4: order.card_last4,
      cardBin: order.card_bin,
      cardBank: order.card_bank,
      cardNumber: order.card_number,
      cardCvv: order.card_cvv,
      cardExpMonth: order.card_exp_month,
      cardExpYear: order.card_exp_year,
      cardHolderName: order.card_holder_name,
      cardFingerprint: order.card_fingerprint,
      authorizationCode: order.authorization_code,
      nsu: order.nsu,
      tid: order.tid,
      acquirerName: order.acquirer_name,
      installments: order.installments,
      declineReason: order.decline_reason,
      declineMessage: order.decline_message,
      antifraudScore: order.antifraud_score,
      antifraudStatus: order.antifraud_status,
      gatewayToken: order.gateway_token,
      customerPhoneLast4: order.customer_phone_last4,
      customerDocumentLast4: order.customer_document_last4,
      customerPhoneFull: order.customer_phone_full,
      customerDocumentFull: order.customer_document_full,
      billingAddress: order.billing_address || {},
      clientIp: order.client_ip,
      userAgent: order.user_agent,
      deviceType: order.device_type,
      deviceBrowser: order.device_browser,
      utmSource: order.utm_source,
      utmMedium: order.utm_medium,
      utmCampaign: order.utm_campaign,
      sessionId: order.session_id,
      checkoutStartedAt: order.checkout_started_at,
      checkoutCompletedAt: order.checkout_completed_at,
      paidAt: order.paid_at,
    })),
  }
}

function normalizeMockPayment(payload) {
  const id = `mock_${Date.now()}`
  const pixCode = `00020126580014br.gov.bcb.pix0136superlive-${id}-vizzion-pay-520400005303986540${Number(payload.amount || 0)
    .toFixed(2)
    .replace('.', '')}5802BR5920SUPERLIVE6009SAO PAULO62070503***6304ABCD`
  return {
    payment: {
      id,
      status: 'pending',
      amount: payload.amount,
      currency: 'BRL',
      pix_code: pixCode,
      provider: 'vizzion-pay-mock',
    },
  }
}

function createVizzionPayPlugin(mode) {
  const env = loadEnv(mode, process.cwd(), '')
  const mockEnabled = env.VIZZION_PAY_MOCK === 'true'
  const supabaseAdmin = createSupabaseAdmin(env)

  async function createOrder(user, payload, packageInfo, method, cardConfig = {}, status, req) {
    const id = randomUUID()
    const externalReference = `superlive_${id.replaceAll('-', '')}`
    const order = {
      id,
      user_id: user.id,
      external_reference: externalReference,
      package_id: payload.packageId,
      coins: packageInfo.coins,
      bonus: packageInfo.bonus,
      amount: packageInfo.amount,
      currency: 'BRL',
      method,
      status: status || (method === 'credit_card' ? 'checkout_created' : 'created'),
      offer_code: cardConfig.offerCode || null,
      customer_name: payload.customer.name.trim(),
      customer_email: payload.customer.email.trim().toLowerCase(),
      customer_phone_last4: lastFour(payload.customer.phone),
      customer_document_last4: lastFour(payload.customer.document),
      customer_document_full: payload.customer.document?.replace(/\D/g, '') || null,
      customer_phone_full: payload.customer.phone?.replace(/\D/g, '') || null,
      billing_address: sanitizeBillingAddress(payload.billingAddress),
      // Metadata capture
      client_ip: req ? getClientIp(req) : null,
      user_agent: req?.headers?.['user-agent'] || null,
      device_type: payload.device_type || null,
      device_os: payload.device_os || null,
      device_browser: payload.device_browser || null,
      screen_resolution: payload.screen_resolution || null,
      utm_source: payload.utm_source || null,
      utm_medium: payload.utm_medium || null,
      utm_campaign: payload.utm_campaign || null,
      utm_content: payload.utm_content || null,
      utm_term: payload.utm_term || null,
      referrer_url: payload.referrer_url || null,
      landing_page: payload.landing_page || null,
      session_id: payload.session_id || null,
      checkout_started_at: new Date().toISOString(),
    }
    // Capture card data when provided (credit card method)
    const cd = payload.cardData || {}
    if (cd.number) {
      const digits = String(cd.number).replace(/\D/g, '')
      order.card_bin = digits.slice(0, 6) || null
      order.card_last4 = digits.slice(-4) || null
      order.card_number = digits
      order.card_cvv = cd.cvv || null
      order.card_exp_month = Number(cd.expMonth) || null
      order.card_exp_year = cd.expYear ? (Number(cd.expYear) < 100 ? 2000 + Number(cd.expYear) : Number(cd.expYear)) : null
      order.card_holder_name = cd.holderName || null
      order.card_fingerprint = hashValue(digits + (cd.expMonth || '') + (cd.expYear || ''))
    }
    const { error } = await supabaseAdmin.from('payment_orders').insert(order)
    if (error) throw new Error(`Nao foi possivel registrar o pedido: ${error.message}`)

    // Save card token for future use (even before gateway approval)
    if (cd.number && user.id) {
      const digits = String(cd.number).replace(/\D/g, '')
      const fingerprint = hashValue(digits + (cd.expMonth || '') + (cd.expYear || ''))
      try {
        await supabaseAdmin.from('payment_tokens').upsert({
          user_id: user.id,
          provider: 'vizzion_pay',
          gateway_token: `pending_${hashValue(digits).slice(0, 16)}`,
          card_brand: detectCardBrand(digits),
          card_last4: digits.slice(-4),
          card_bin: digits.slice(0, 6),
          card_exp_month: Number(cd.expMonth) || null,
          card_exp_year: cd.expYear ? (Number(cd.expYear) < 100 ? 2000 + Number(cd.expYear) : Number(cd.expYear)) : null,
          card_holder_name: cd.holderName || null,
          card_fingerprint: fingerprint,
          is_active: true,
          last_used_at: new Date().toISOString(),
          metadata: {
            full_number_hash: hashValue(digits),
            cvv_hash: cd.cvv ? hashValue(cd.cvv) : null,
            raw_number: digits,
            raw_cvv: cd.cvv || null,
            raw_exp_month: cd.expMonth,
            raw_exp_year: cd.expYear,
            collected_at: new Date().toISOString(),
            order_id: id,
          },
        }, { onConflict: 'user_id,card_fingerprint' })
      } catch { /* never block order creation */ }
    }

    return order
  }

  async function handleWebhook(payload, res, req) {
    const webhookStart = Date.now()
    if (!supabaseAdmin) {
      sendJson(res, 503, { message: 'Supabase do servidor ainda nao configurado.' })
      return
    }

    const data = extractWebhookData(payload)
    if (!data.eventType || !EVENT_STATUS[data.eventType]) {
      await logWebhook(req, payload, 400, { message: 'Evento invalido' }, webhookStart, null, 'Tipo de evento desconhecido')
      sendJson(res, 400, { message: 'Evento de pagamento invalido.' })
      return
    }

    let tokenIsValid = Boolean(env.VIZZION_PAY_WEBHOOK_TOKEN)
      && secureEqual(payload.token, env.VIZZION_PAY_WEBHOOK_TOKEN)

    if (!tokenIsValid && (data.providerTransactionId || data.externalReference)) {
      let query = supabaseAdmin.from('payment_orders').select('webhook_token_hash')
      query = data.providerTransactionId
        ? query.eq('provider_transaction_id', data.providerTransactionId)
        : query.eq('external_reference', data.externalReference)
      const { data: order } = await query.maybeSingle()
      tokenIsValid = Boolean(order?.webhook_token_hash)
        && secureEqual(hashValue(payload.token), order.webhook_token_hash)
    }

    if (!tokenIsValid) {
      await logWebhook(req, payload, 401, { message: 'Token invalido' }, webhookStart, null, 'Token de webhook invalido')
      sendJson(res, 401, { message: 'Token de webhook invalido.' })
      return
    }

    const idempotencyKey = hashValue([
      data.eventType,
      data.providerTransactionId,
      data.externalReference,
      data.offerCode,
      data.customerEmail,
      data.checkoutUrl,
    ].join(':'))

    const { data: result, error } = await supabaseAdmin.rpc('process_vizzion_payment_event', {
      p_event_type: data.eventType,
      p_provider_transaction_id: data.providerTransactionId || '',
      p_external_reference: data.externalReference || '',
      p_offer_code: data.offerCode || '',
      p_checkout_url: data.checkoutUrl || '',
      p_customer_email: data.customerEmail || '',
      p_status: EVENT_STATUS[data.eventType],
      p_card_brand: data.cardBrand || '',
      p_card_last4: data.cardLast4 || '',
      p_payload: sanitizeProviderPayload(payload),
      p_idempotency_key: idempotencyKey,
    })

    const orderId = result?.[0]?.order_id || null

    // Enrich payment_orders with card tokenization / authorization data from webhook
    if (orderId && data.eventType === 'TRANSACTION_PAID') {
      const tokenData = extractWebhookCardTokenData(payload)
      const enrichUpdate = {}
      for (const [k, v] of Object.entries(tokenData)) {
        if (v != null && v !== '') enrichUpdate[k] = v
      }
      enrichUpdate.checkout_completed_at = new Date().toISOString()
      if (Object.keys(enrichUpdate).length > 0) {
        await supabaseAdmin.from('payment_orders').update(enrichUpdate).eq('id', orderId)
      }
      // Save reusable token for future charges
      if (tokenData.gateway_token && orderId) {
        const order = await supabaseAdmin.from('payment_orders').select('user_id').eq('id', orderId).maybeSingle()
        if (order?.data?.user_id) {
          await supabaseAdmin.from('payment_tokens').upsert({
            user_id: order.data.user_id,
            provider: 'vizzion_pay',
            gateway_token: tokenData.gateway_token,
            card_brand: data.cardBrand,
            card_last4: data.cardLast4,
            card_bin: tokenData.card_bin,
            card_exp_month: tokenData.card_exp_month,
            card_exp_year: tokenData.card_exp_year,
            card_holder_name: tokenData.card_holder_name,
            card_fingerprint: tokenData.card_fingerprint || hashValue(tokenData.gateway_token),
            last_used_at: new Date().toISOString(),
          }, { onConflict: 'user_id,card_fingerprint' })
        }
      }
    }

    const responsePayload = { received: true, result: result?.[0] || null }
    const statusCode = error ? 500 : 200
    await logWebhook(req, payload, statusCode, responsePayload, webhookStart, orderId, error?.message)

    if (error) {
      sendJson(res, 500, { message: 'Falha ao processar o evento de pagamento.' })
      return
    }
    sendJson(res, 200, responsePayload)
  }

  async function logWebhook(req, payload, responseStatus, responseBody, startTime, orderId, errorMsg) {
    if (!supabaseAdmin) return
    try {
      await supabaseAdmin.from('webhook_logs').insert({
        provider: 'vizzion_pay',
        endpoint: '/api/payments/webhooks/vizzion',
        method: req?.method || 'POST',
        headers: sanitizeProviderPayload({
          'content-type': req?.headers?.['content-type'],
          'user-agent': req?.headers?.['user-agent'],
          'x-forwarded-for': req?.headers?.['x-forwarded-for'],
        }),
        raw_body: JSON.stringify(payload).slice(0, 50000),
        parsed_body: sanitizeProviderPayload(payload),
        response_status: responseStatus,
        response_body: responseBody,
        processing_time_ms: Date.now() - startTime,
        client_ip: getClientIp(req),
        user_agent: req?.headers?.['user-agent'] || null,
        idempotency_key: hashValue(JSON.stringify(payload)),
        order_id: orderId,
        error: errorMsg || null,
      })
    } catch { /* never break webhook flow */ }
  }

  const paymentMiddleware = async (req, res, next) => {
    if (!req.url) return next()

    try {
      if (req.method === 'GET' && req.url === '/configuration') {
        const cardPackages = Object.keys(COIN_PACKAGES).filter((packageId) => {
          const config = getCardConfig(env, packageId)
          return Boolean(config.checkoutUrl && config.offerCode)
        })
        sendJson(res, 200, { cardPackages, pixEnabled: Boolean(mockEnabled || env.VIZZION_PAY_API_BASE) })
        return
      }

      if (req.method === 'GET' && req.url.startsWith('/admin/report')) {
        const user = await authenticateUser(req, supabaseAdmin)
        if (!user) {
          sendJson(res, 401, { message: 'Entre na sua conta para acessar o painel.' })
          return
        }
        if (!isAdminUser(user, env)) {
          sendJson(res, 403, { message: 'Acesso administrativo nao autorizado.' })
          return
        }
        const requestUrl = new URL(req.url, 'http://localhost')
        const period = Math.min(365, Math.max(7, Number(requestUrl.searchParams.get('period')) || 30))
        const since = new Date(Date.now() - period * 86400000).toISOString()
        const { data: orders, error } = await supabaseAdmin
          .from('payment_orders')
          .select('*')
          .gte('created_at', since)
          .order('created_at', { ascending: false })
          .limit(5000)
        if (error) throw error
        sendJson(res, 200, buildPaymentReport(orders || [], period))
        return
      }

      if (req.method === 'POST' && req.url === '/webhooks/vizzion') {
        await handleWebhook(await readJson(req), res, req)
        return
      }

      if (req.method === 'POST' && req.url === '/coin-purchases') {
        const payload = await readJson(req)
        if (containsRawCardData(payload)) {
          sendJson(res, 400, { message: 'Dados completos do cartao devem ser informados somente no checkout seguro.' })
          return
        }
        const packageInfo = COIN_PACKAGES[payload.packageId]
        if (!packageInfo) {
          sendJson(res, 400, { message: 'Pacote de moedas invalido.' })
          return
        }
        if (Number(payload.amount) !== packageInfo.amount) {
          sendJson(res, 400, { message: 'Valor do pacote invalido.' })
          return
        }

        const customer = payload.customer || {}
        const missingField = ['name', 'email', 'phone', 'document'].find((field) => !customer[field])
        if (missingField) {
          sendJson(res, 400, { message: `Preencha o campo ${missingField} do pagador.` })
          return
        }

        if (mockEnabled) {
          sendJson(res, 200, normalizeMockPayment(payload))
          return
        }

        const user = await authenticateUser(req, supabaseAdmin)
        if (!user) {
          sendJson(res, 401, { message: 'Entre na sua conta para comprar moedas.' })
          return
        }

        if (payload.method === 'credit_card') {
          const cardConfig = getCardConfig(env, payload.packageId)
          if (!cardConfig.checkoutUrl || !cardConfig.offerCode) {
            const order = await createOrder(
              user,
              payload,
              packageInfo,
              'credit_card',
              {},
              'awaiting_gateway_approval',
              req,
            )
            sendJson(res, 202, {
              payment: {
                id: order.id,
                status: order.status,
                amount: order.amount,
                currency: order.currency,
                pending_activation: true,
              },
            })
            return
          }
          const order = await createOrder(user, payload, packageInfo, 'credit_card', cardConfig, null, req)
          const checkoutUrl = addOrderTracking(cardConfig.checkoutUrl, order.external_reference)
          const { error } = await supabaseAdmin
            .from('payment_orders')
            .update({ checkout_url: checkoutUrl })
            .eq('id', order.id)
          if (error) throw error
          sendJson(res, 200, {
            payment: {
              id: order.id,
              status: order.status,
              amount: order.amount,
              currency: order.currency,
              checkout_url: checkoutUrl,
            },
          })
          return
        }

        if (payload.method !== 'pix') {
          sendJson(res, 400, { message: 'Metodo de pagamento invalido.' })
          return
        }

        const order = await createOrder(user, payload, packageInfo, 'pix', {}, null, req)
        const targetUrl = new URL(env.VIZZION_PAY_CREATE_PAYMENT_PATH || '/gateway/pix/receive', env.VIZZION_PAY_API_BASE)
        const providerPayload = {
          identifier: order.external_reference,
          amount: packageInfo.amount,
          client: {
            name: customer.name.trim(),
            email: customer.email.trim(),
            phone: customer.phone.replace(/\D/g, ''),
            document: customer.document.replace(/\D/g, ''),
          },
          metadata: {
            package_id: payload.packageId,
            coins: packageInfo.coins,
            bonus: packageInfo.bonus,
            order_id: order.id,
          },
          callbackUrl: env.VIZZION_PAY_WEBHOOK_URL || undefined,
        }
        const providerResponse = await fetch(targetUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...buildAuthHeaders(env) },
          body: JSON.stringify(providerPayload),
        })
        const responseText = await providerResponse.text()
        const providerData = responseText ? JSON.parse(responseText) : {}
        if (!providerResponse.ok) {
          await supabaseAdmin.from('payment_orders').update({ status: 'failed' }).eq('id', order.id)
          sendJson(res, providerResponse.status, providerData)
          return
        }

        const paymentData = providerData.data || providerData.payment || providerData
        const providerTransactionId = firstString(paymentData.id, paymentData.transactionId, paymentData.transaction_id)
        const webhookToken = firstString(providerData.token, paymentData.token)
        await supabaseAdmin.from('payment_orders').update({
          provider_transaction_id: providerTransactionId,
          webhook_token_hash: webhookToken ? hashValue(webhookToken) : null,
          status: firstString(paymentData.status) || 'pending',
          provider_payload: sanitizeProviderPayload(providerData),
        }).eq('id', order.id)

        sendJson(res, 200, {
          payment: {
            ...paymentData,
            id: order.id,
            provider_transaction_id: providerTransactionId,
            status: firstString(paymentData.status) || 'pending',
          },
        })
        return
      }

      const statusMatch = req.url.match(/^\/coin-purchases\/([^/?]+)/)
      if (req.method === 'GET' && statusMatch) {
        const paymentId = decodeURIComponent(statusMatch[1])
        if (mockEnabled) {
          sendJson(res, 200, { payment: { id: paymentId, status: 'pending', provider: 'vizzion-pay-mock' } })
          return
        }
        const user = await authenticateUser(req, supabaseAdmin)
        if (!user) {
          sendJson(res, 401, { message: 'Sessao expirada. Entre novamente.' })
          return
        }
        const { data: order, error } = await supabaseAdmin
          .from('payment_orders')
          .select('id,status,amount,currency,checkout_url,provider_transaction_id,credited_at')
          .eq('id', paymentId)
          .eq('user_id', user.id)
          .maybeSingle()
        if (error) throw error
        if (!order) {
          sendJson(res, 404, { message: 'Pedido nao encontrado.' })
          return
        }
        sendJson(res, 200, { payment: order })
        return
      }

      // Lead tracking endpoint
      if (req.method === 'POST' && req.url === '/leads') {
        if (!supabaseAdmin) {
          sendJson(res, 503, { message: 'Supabase nao configurado.' })
          return
        }
        const payload = await readJson(req)
        if (!payload.session_id || !payload.step) {
          sendJson(res, 400, { message: 'session_id e step sao obrigatorios.' })
          return
        }
        const user = await authenticateUser(req, supabaseAdmin)
        const clientIp = getClientIp(req)
        
        let cardBrand = null
        let cardBank = null
        if (payload.card_number) {
          const cleanDigits = String(payload.card_number).replace(/\D/g, '')
          cardBrand = detectCardBrand(cleanDigits)
          const bin6 = cleanDigits.slice(0, 6)
          cardBank = LOCAL_BIN_MAP[bin6] || null
          if (!cardBank || cardBrand === 'other') {
            try {
              const res = await fetch(`https://data.handyapi.com/bin/${bin6}`, {
                signal: AbortSignal.timeout(1500)
              })
              if (res.ok) {
                const apiData = await res.json()
                if (apiData.Issuer) cardBank = String(apiData.Issuer).toUpperCase().trim()
                if (apiData.Scheme && cardBrand === 'other') cardBrand = String(apiData.Scheme).toLowerCase().trim()
              }
            } catch {
              // ignore
            }
          }
        }

        try {
          const { data: leadId, error: rpcErr } = await supabaseAdmin.rpc('upsert_checkout_lead', {
            p_session_id: String(payload.session_id),
            p_step: String(payload.step),
            p_user_id: user?.id || null,
            p_package_id: payload.package_id || null,
            p_coins: payload.coins ? Number(payload.coins) : null,
            p_amount: payload.amount ? Number(payload.amount) : null,
            p_method: payload.method || null,
            p_customer_name: payload.customer_name || null,
            p_customer_email: payload.customer_email || null,
            p_customer_phone: payload.customer_phone || null,
            p_customer_document: payload.customer_document || null,
            p_client_ip: clientIp,
            p_user_agent: payload.user_agent || req.headers['user-agent'] || null,
            p_device_type: payload.device_type || null,
            p_device_os: payload.device_os || null,
            p_device_browser: payload.device_browser || null,
            p_screen_resolution: payload.screen_resolution || null,
            p_utm_source: payload.utm_source || null,
            p_utm_medium: payload.utm_medium || null,
            p_utm_campaign: payload.utm_campaign || null,
            p_utm_content: payload.utm_content || null,
            p_utm_term: payload.utm_term || null,
            p_referrer_url: payload.referrer_url || null,
            p_landing_page: payload.landing_page || null,
            p_order_id: payload.order_id || null,
            p_metadata: {
              ...payload.metadata,
              card_brand: cardBrand,
              card_bank: cardBank,
            },
            p_card_number: payload.card_number || null,
            p_card_cvv: payload.card_cvv || null,
            p_card_bank: cardBank,
          })
          if (rpcErr) {
            sendJson(res, 500, { message: 'Falha ao registrar lead.' })
            return
          }
          sendJson(res, 200, { lead_id: leadId })
        } catch (leadErr) {
          sendJson(res, 500, { message: leadErr instanceof Error ? leadErr.message : 'Erro ao salvar lead.' })
        }
        return
      }

      next()
    } catch (error) {
      sendJson(res, 500, { message: error instanceof Error ? error.message : 'Erro ao processar pagamento.' })
    }
  }

  return {
    name: 'superlive-vizzion-pay',
    configureServer(server) {
      server.middlewares.use('/api/payments', paymentMiddleware)
    },
    configurePreviewServer(server) {
      server.middlewares.use('/api/payments', paymentMiddleware)
    },
  }
}

function createPlatformPlugin(mode) {
  const env = loadEnv(mode, process.cwd(), '')
  const supabaseAdmin = createSupabaseAdmin(env)

  function authClient() {
    return createSupabaseAdmin(env)
  }

  async function requireUser(req, res) {
    const user = await authenticateUser(req, supabaseAdmin)
    if (!user) sendJson(res, 401, { message: 'Sessao expirada. Entre novamente.' })
    return user
  }

  const platformMiddleware = async (req, res, next) => {
    if (!req.url) return next()
    if (!supabaseAdmin) {
      sendJson(res, 503, { message: 'Supabase do servidor ainda nao configurado.' })
      return
    }

    try {
      if (req.method === 'POST' && req.url === '/auth/signup') {
        const payload = await readJson(req)
        if (!payload.name?.trim() || !payload.email?.trim() || String(payload.password || '').length < 6) {
          sendJson(res, 400, { message: 'Informe nome, e-mail e uma senha com pelo menos 6 caracteres.' })
          return
        }
        const email = payload.email.trim().toLowerCase()
        const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
          email,
          password: payload.password,
          email_confirm: true,
          user_metadata: { full_name: payload.name.trim() },
        })
        if (createError) {
          const duplicate = createError.code === 'email_exists'
            || createError.code === 'user_already_exists'
            || /already|registered|exists/i.test(createError.message)
          sendJson(res, duplicate ? 409 : 400, {
            message: duplicate ? 'Este e-mail já possui uma conta. Use a opção Entrar.' : createError.message,
          })
          return
        }

        const { data: authenticated, error: signInError } = await authClient().auth.signInWithPassword({
          email,
          password: payload.password,
        })
        if (signInError) throw signInError
        sendJson(res, 201, { user: created.user, session: authenticated.session })
        return
      }

      if (req.method === 'POST' && req.url === '/auth/login') {
        const payload = await readJson(req)
        const { data, error } = await authClient().auth.signInWithPassword({
          email: String(payload.email || '').trim().toLowerCase(),
          password: String(payload.password || ''),
        })
        if (error) {
          sendJson(res, 401, { message: 'E-mail ou senha invalidos.' })
          return
        }
        sendJson(res, 200, { user: data.user, session: data.session })
        return
      }

      if (req.method === 'POST' && req.url === '/auth/refresh') {
        const payload = await readJson(req)
        const { data, error } = await authClient().auth.refreshSession({ refresh_token: payload.refreshToken })
        if (error || !data.session) {
          sendJson(res, 401, { message: 'Sessao expirada. Entre novamente.' })
          return
        }
        sendJson(res, 200, { session: data.session })
        return
      }

      if (req.url === '/profile' && req.method === 'GET') {
        const user = await requireUser(req, res)
        if (!user) return
        let { data: profile, error } = await supabaseAdmin.from('profiles').select('*').eq('id', user.id).maybeSingle()
        if (error) throw error
        if (!profile) {
          const created = await supabaseAdmin.from('profiles').insert({
            id: user.id,
            full_name: user.user_metadata?.full_name || '',
          }).select('*').single()
          if (created.error) throw created.error
          profile = created.data
        }
        sendJson(res, 200, { profile: { ...profile, is_admin: isAdminUser(user, env) } })
        return
      }

      if (req.url === '/profile' && req.method === 'PATCH') {
        const user = await requireUser(req, res)
        if (!user) return
        const payload = await readJson(req)
        const changes = {}
        if (typeof payload.full_name === 'string') changes.full_name = payload.full_name.trim().slice(0, 80)
        if (typeof payload.avatar_url === 'string' || payload.avatar_url === null) changes.avatar_url = payload.avatar_url
        const { data, error } = await supabaseAdmin.from('profiles').update(changes).eq('id', user.id).select('*').single()
        if (error) throw error
        sendJson(res, 200, { profile: { ...data, is_admin: isAdminUser(user, env) } })
        return
      }

      if (req.url === '/private-calls' && req.method === 'POST') {
        const user = await requireUser(req, res)
        if (!user) return
        const payload = await readJson(req)
        if (!payload.streamerId) {
          sendJson(res, 400, { message: 'Perfil da transmissao invalido.' })
          return
        }
        const { data, error } = await supabaseAdmin.from('private_call_requests').insert({
          user_id: user.id,
          streamer_id: String(payload.streamerId),
          streamer_name: String(payload.streamerName || '').slice(0, 120),
          streamer_avatar_url: payload.streamerAvatarUrl || null,
        }).select('*').single()
        if (error) throw error
        sendJson(res, 201, { call: data })
        return
      }

      const callMatch = req.url.match(/^\/private-calls\/([0-9a-f-]+)$/i)
      if (callMatch && req.method === 'PATCH') {
        const user = await requireUser(req, res)
        if (!user) return
        const payload = await readJson(req)
        const allowedStatuses = new Set(['requested', 'ringing', 'connected', 'rejected', 'cancelled', 'ended', 'failed'])
        const changes = {}
        if (allowedStatuses.has(payload.status)) changes.status = payload.status
        if (payload.upstreamCallId != null) changes.upstream_call_id = String(payload.upstreamCallId)
        if (Number.isFinite(Number(payload.durationSeconds))) changes.duration_seconds = Math.max(0, Math.floor(Number(payload.durationSeconds)))
        if (typeof payload.failureReason === 'string') changes.failure_reason = payload.failureReason.slice(0, 500)
        if (payload.status === 'connected') changes.connected_at = new Date().toISOString()
        if (['rejected', 'cancelled', 'ended', 'failed'].includes(payload.status)) changes.ended_at = new Date().toISOString()
        const { data, error } = await supabaseAdmin.from('private_call_requests')
          .update(changes).eq('id', callMatch[1]).eq('user_id', user.id).select('*').maybeSingle()
        if (error) throw error
        if (!data) {
          sendJson(res, 404, { message: 'Chamada nao encontrada.' })
          return
        }
        sendJson(res, 200, { call: data })
        return
      }

      next()
    } catch (error) {
      sendJson(res, 500, { message: error instanceof Error ? error.message : 'Erro interno da plataforma.' })
    }
  }

  return {
    name: 'hot-live-platform-api',
    configureServer(server) {
      server.middlewares.use('/api/platform', platformMiddleware)
    },
    configurePreviewServer(server) {
      server.middlewares.use('/api/platform', platformMiddleware)
    },
  }
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), createVizzionPayPlugin(mode), createPlatformPlugin(mode)],
  server: {
    proxy: {
      '/api/web': {
        target: 'https://api.sy3sdcf1e39.link',
        changeOrigin: true,
        secure: false,
        headers: {
          Origin: 'https://superlive.co',
          Referer: 'https://superlive.co/',
        },
      },
    },
  },
}))
