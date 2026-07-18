import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

const packages: Record<string, { coins: number; bonus: number; amount: number }> = {
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

const eventStatus: Record<string, string> = {
  TRANSACTION_CREATED: 'pending',
  TRANSACTION_PAID: 'paid',
  TRANSACTION_CANCELED: 'canceled',
  TRANSACTION_REFUNDED: 'refunded',
  TRANSACTION_CHARGED_BACK: 'charged_back',
}

const env = (key: string) => Deno.env.get(key) || ''
const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false, autoRefreshToken: false },
})

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function firstString(...values: unknown[]) {
  const value = values.find((item) => typeof item === 'string' || typeof item === 'number')
  return value == null ? null : String(value)
}

function lastFour(value: unknown) {
  const digits = String(value || '').replace(/\D/g, '')
  return digits ? digits.slice(-4) : null
}

function safeBillingAddress(value: Record<string, unknown> = {}) {
  return {
    postalCode: String(value.postalCode || '').replace(/\D/g, '').slice(0, 8),
    street: String(value.street || '').trim().slice(0, 160),
    number: String(value.number || '').trim().slice(0, 20),
    district: String(value.district || '').trim().slice(0, 80),
    city: String(value.city || '').trim().slice(0, 80),
    state: String(value.state || '').trim().toUpperCase().slice(0, 2),
  }
}

function containsRawCardData(payload: Record<string, unknown>) {
  if (!payload || typeof payload !== 'object') return false
  const blocked = new Set([
    'card', 'cardnumber', 'card_number', 'pan', 'cvv', 'cvc', 'securitycode',
    'expiry', 'expiration', 'validade',
  ])
  return Object.entries(payload).some(([key, value]) => (
    blocked.has(key.toLowerCase())
      || (Boolean(value) && typeof value === 'object' && containsRawCardData(value as Record<string, unknown>))
  ))
}

function isAdminUser(user: any) {
  if (user?.app_metadata?.role === 'admin') return true
  const emails = env('ADMIN_EMAILS').split(',').map((email) => email.trim().toLowerCase()).filter(Boolean)
  return emails.includes(String(user?.email || '').toLowerCase())
}

function amountOf(order: Record<string, any>, field = 'amount') {
  const value = Number(order?.[field] || 0)
  return Number.isFinite(value) ? value : 0
}

function paymentReport(orders: Record<string, any>[], period: number) {
  const paidStatuses = new Set(['paid', 'approved', 'authorized', 'completed', 'confirmed', 'success'])
  const pendingStatuses = new Set(['created', 'pending', 'checkout_created', 'awaiting_gateway_approval'])
  const paid = orders.filter((order) => order.paid_at || paidStatuses.has(String(order.status).toLowerCase()))
  const grossRevenue = paid.reduce((sum, order) => sum + amountOf(order), 0)
  const refunds = orders.reduce((sum, order) => sum + (
    amountOf(order, 'refunded_amount')
      || (String(order.status).toLowerCase() === 'refunded' ? amountOf(order) : 0)
  ), 0)
  const chargebacks = orders.filter((order) => String(order.status).toLowerCase() === 'charged_back')
    .reduce((sum, order) => sum + amountOf(order), 0)
  const providerFees = paid.reduce((sum, order) => sum + amountOf(order, 'provider_fee'), 0)
  const operationalCosts = paid.reduce((sum, order) => sum + amountOf(order, 'operational_cost'), 0)
  const daily = new Map<string, { date: string; revenue: number; orders: number }>()
  for (let offset = period - 1; offset >= 0; offset -= 1) {
    const date = new Date()
    date.setUTCHours(0, 0, 0, 0)
    date.setUTCDate(date.getUTCDate() - offset)
    const key = date.toISOString().slice(0, 10)
    daily.set(key, { date: key, revenue: 0, orders: 0 })
  }
  paid.forEach((order) => {
    const point = daily.get(String(order.paid_at || order.created_at).slice(0, 10))
    if (point) { point.revenue += amountOf(order); point.orders += 1 }
  })
  const packageMap = new Map<string, any>()
  paid.forEach((order) => {
    const current = packageMap.get(order.package_id) || {
      packageId: order.package_id, coins: Number(order.coins || 0) + Number(order.bonus || 0), sales: 0, revenue: 0,
    }
    current.sales += 1
    current.revenue += amountOf(order)
    packageMap.set(order.package_id, current)
  })
  const netRevenue = grossRevenue - refunds - chargebacks - providerFees
  return {
    period,
    generatedAt: new Date().toISOString(),
    metrics: {
      grossRevenue, netRevenue, estimatedProfit: netRevenue - operationalCosts, refunds, chargebacks,
      providerFees, operationalCosts, totalOrders: orders.length, paidOrders: paid.length,
      pendingOrders: orders.filter((order) => pendingStatuses.has(String(order.status).toLowerCase())).length,
      customers: new Set(orders.map((order) => order.user_id)).size,
      paidCustomers: new Set(paid.map((order) => order.user_id)).size,
      averageTicket: paid.length ? grossRevenue / paid.length : 0,
      conversionRate: orders.length ? (paid.length / orders.length) * 100 : 0,
      coinsSold: paid.reduce((sum, order) => sum + Number(order.coins || 0) + Number(order.bonus || 0), 0),
    },
    daily: Array.from(daily.values()),
    packages: Array.from(packageMap.values()).sort((left, right) => right.revenue - left.revenue),
    recentOrders: orders.slice(0, 30).map((order) => ({
      id: order.id, createdAt: order.created_at, customerName: order.customer_name,
      customerEmail: order.customer_email, packageId: order.package_id,
      coins: Number(order.coins || 0) + Number(order.bonus || 0), amount: amountOf(order),
      method: order.method, status: order.status, cardBrand: order.card_brand, cardLast4: order.card_last4,
      customerPhoneLast4: order.customer_phone_last4, customerDocumentLast4: order.customer_document_last4,
      billingAddress: order.billing_address || {},
    })),
  }
}

async function sha256(value: unknown) {
  const bytes = new TextEncoder().encode(String(value || ''))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function sanitize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitize)
  if (!value || typeof value !== 'object') return value
  const blocked = new Set([
    'token', 'cvv', 'cvc', 'securitycode', 'cardnumber', 'card_number',
    'document', 'cpf', 'cnpj', 'password', 'secret',
  ])
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !blocked.has(key.toLowerCase()))
      .map(([key, child]) => [key, sanitize(child)]),
  )
}

function cardConfig(packageId: string) {
  const suffix = packageId.toUpperCase()
  return {
    checkoutUrl: env(`VIZZION_PAY_CARD_CHECKOUT_${suffix}`),
    offerCode: env(`VIZZION_PAY_CARD_OFFER_${suffix}`),
  }
}

function trackedCheckout(urlValue: string, reference: string) {
  const url = new URL(urlValue)
  url.searchParams.set('utm_source', 'superlive')
  url.searchParams.set('utm_medium', 'app')
  url.searchParams.set('utm_campaign', 'coins')
  url.searchParams.set('utm_content', reference)
  return url.toString()
}

async function authenticatedUser(request: Request) {
  const authorization = request.headers.get('Authorization') || ''
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : ''
  if (!token) return null
  const { data, error } = await admin.auth.getUser(token)
  return error ? null : data.user
}

async function createOrder(
  userId: string,
  payload: Record<string, any>,
  packageInfo: { coins: number; bonus: number; amount: number },
  method: 'pix' | 'credit_card',
  offerCode?: string,
  status?: string,
) {
  const id = crypto.randomUUID()
  const externalReference = `superlive_${id.replaceAll('-', '')}`
  const customer = payload.customer
  const order = {
    id,
    user_id: userId,
    external_reference: externalReference,
    package_id: payload.packageId,
    coins: packageInfo.coins,
    bonus: packageInfo.bonus,
    amount: packageInfo.amount,
    currency: 'BRL',
    method,
    status: status || (method === 'credit_card' ? 'checkout_created' : 'created'),
    offer_code: offerCode || null,
    customer_name: customer.name.trim(),
    customer_email: customer.email.trim().toLowerCase(),
    customer_phone_last4: lastFour(customer.phone),
    customer_document_last4: lastFour(customer.document),
    billing_address: safeBillingAddress(payload.billingAddress || {}),
  }
  const { error } = await admin.from('payment_orders').insert(order)
  if (error) throw error
  return order
}

function webhookData(payload: Record<string, any>) {
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

async function handleWebhook(payload: Record<string, any>) {
  const data = webhookData(payload)
  if (!data.eventType || !eventStatus[data.eventType]) return json(400, { message: 'Evento invalido.' })

  let validToken = Boolean(env('VIZZION_PAY_WEBHOOK_TOKEN'))
    && await sha256(payload.token) === await sha256(env('VIZZION_PAY_WEBHOOK_TOKEN'))

  if (!validToken && (data.providerTransactionId || data.externalReference)) {
    let query = admin.from('payment_orders').select('webhook_token_hash')
    query = data.providerTransactionId
      ? query.eq('provider_transaction_id', data.providerTransactionId)
      : query.eq('external_reference', data.externalReference)
    const { data: order } = await query.maybeSingle()
    validToken = Boolean(order?.webhook_token_hash)
      && await sha256(payload.token) === order.webhook_token_hash
  }
  if (!validToken) return json(401, { message: 'Token de webhook invalido.' })

  const idempotencyKey = await sha256([
    data.eventType,
    data.providerTransactionId,
    data.externalReference,
    data.offerCode,
    data.customerEmail,
    data.checkoutUrl,
  ].join(':'))
  const { data: result, error } = await admin.rpc('process_vizzion_payment_event', {
    p_event_type: data.eventType,
    p_provider_transaction_id: data.providerTransactionId || '',
    p_external_reference: data.externalReference || '',
    p_offer_code: data.offerCode || '',
    p_checkout_url: data.checkoutUrl || '',
    p_customer_email: data.customerEmail || '',
    p_status: eventStatus[data.eventType],
    p_card_brand: data.cardBrand || '',
    p_card_last4: data.cardLast4 || '',
    p_payload: sanitize(payload),
    p_idempotency_key: idempotencyKey,
  })
  if (error) return json(500, { message: 'Falha ao processar o evento.' })
  return json(200, { received: true, result: result?.[0] || null })
}

async function createPurchase(request: Request) {
  const payload = await request.json()
  if (containsRawCardData(payload)) {
    return json(400, { message: 'Dados completos do cartao devem ser informados somente no checkout seguro.' })
  }
  const packageInfo = packages[payload.packageId]
  if (!packageInfo || Number(payload.amount) !== packageInfo.amount) {
    return json(400, { message: 'Pacote ou valor invalido.' })
  }
  const customer = payload.customer || {}
  const missing = ['name', 'email', 'phone', 'document'].find((field) => !customer[field])
  if (missing) return json(400, { message: `Preencha o campo ${missing} do pagador.` })

  const user = await authenticatedUser(request)
  if (!user) return json(401, { message: 'Entre na sua conta para comprar moedas.' })

  if (payload.method === 'credit_card') {
    const config = cardConfig(payload.packageId)
    if (!config.checkoutUrl || !config.offerCode) {
      const order = await createOrder(user.id, payload, packageInfo, 'credit_card', undefined, 'awaiting_gateway_approval')
      return json(202, {
        payment: {
          id: order.id, status: order.status, amount: order.amount, currency: 'BRL', pending_activation: true,
        },
      })
    }
    const order = await createOrder(user.id, payload, packageInfo, 'credit_card', config.offerCode)
    const checkoutUrl = trackedCheckout(config.checkoutUrl, order.external_reference)
    const { error } = await admin.from('payment_orders').update({ checkout_url: checkoutUrl }).eq('id', order.id)
    if (error) throw error
    return json(200, { payment: { id: order.id, status: order.status, amount: order.amount, currency: 'BRL', checkout_url: checkoutUrl } })
  }

  if (payload.method !== 'pix') return json(400, { message: 'Metodo invalido.' })
  const order = await createOrder(user.id, payload, packageInfo, 'pix')
  const response = await fetch(new URL(env('VIZZION_PAY_CREATE_PAYMENT_PATH') || '/gateway/pix/receive', env('VIZZION_PAY_API_BASE')), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'x-public-key': env('VIZZION_PAY_PUBLIC_KEY'),
      'x-secret-key': env('VIZZION_PAY_SECRET_KEY'),
    },
    body: JSON.stringify({
      identifier: order.external_reference,
      amount: packageInfo.amount,
      client: {
        name: customer.name.trim(),
        email: customer.email.trim(),
        phone: customer.phone.replace(/\D/g, ''),
        document: customer.document.replace(/\D/g, ''),
      },
      metadata: { package_id: payload.packageId, coins: packageInfo.coins, bonus: packageInfo.bonus, order_id: order.id },
      callbackUrl: env('VIZZION_PAY_WEBHOOK_URL') || undefined,
    }),
  })
  const providerData = await response.json().catch(() => ({}))
  if (!response.ok) {
    await admin.from('payment_orders').update({ status: 'failed' }).eq('id', order.id)
    return json(response.status, providerData)
  }
  const payment = providerData.data || providerData.payment || providerData
  const transactionId = firstString(payment.id, payment.transactionId, payment.transaction_id)
  const webhookToken = firstString(providerData.token, payment.token)
  await admin.from('payment_orders').update({
    provider_transaction_id: transactionId,
    webhook_token_hash: webhookToken ? await sha256(webhookToken) : null,
    status: firstString(payment.status) || 'pending',
    provider_payload: sanitize(providerData),
  }).eq('id', order.id)
  return json(200, { payment: { ...payment, id: order.id, provider_transaction_id: transactionId, status: firstString(payment.status) || 'pending' } })
}

async function getPurchase(request: Request, id: string) {
  const user = await authenticatedUser(request)
  if (!user) return json(401, { message: 'Sessao expirada.' })
  const { data, error } = await admin
    .from('payment_orders')
    .select('id,status,amount,currency,checkout_url,provider_transaction_id,credited_at')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle()
  if (error) throw error
  return data ? json(200, { payment: data }) : json(404, { message: 'Pedido nao encontrado.' })
}

async function getAdminReport(request: Request) {
  const user = await authenticatedUser(request)
  if (!user) return json(401, { message: 'Entre na sua conta para acessar o painel.' })
  if (!isAdminUser(user)) return json(403, { message: 'Acesso administrativo nao autorizado.' })
  const period = Math.min(365, Math.max(7, Number(new URL(request.url).searchParams.get('period')) || 30))
  const since = new Date(Date.now() - period * 86400000).toISOString()
  const { data, error } = await admin.from('payment_orders').select('*')
    .gte('created_at', since).order('created_at', { ascending: false }).limit(5000)
  if (error) throw error
  return json(200, paymentReport(data || [], period))
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const path = new URL(request.url).pathname
    if (request.method === 'POST' && path.endsWith('/webhooks/vizzion')) {
      return handleWebhook(await request.json())
    }
    if (request.method === 'POST' && path.endsWith('/coin-purchases')) return createPurchase(request)
    if (request.method === 'GET' && path.endsWith('/admin/report')) return getAdminReport(request)
    const match = path.match(/\/coin-purchases\/([^/]+)$/)
    if (request.method === 'GET' && match) return getPurchase(request, decodeURIComponent(match[1]))
    return json(404, { message: 'Rota nao encontrada.' })
  } catch (error) {
    return json(500, { message: error instanceof Error ? error.message : 'Erro interno.' })
  }
})
