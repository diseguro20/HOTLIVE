import { getSession } from './platform';

const DEFAULT_PAYMENT_API_BASE = '/api/payments';

function getPaymentApiBase() {
  return import.meta.env.VITE_PAYMENT_API_BASE || DEFAULT_PAYMENT_API_BASE;
}

function normalizePaymentResponse(data) {
  const raw = data || {};
  const payment = raw.payment || raw.data || raw;
  const pix = payment.pix || payment.pixInformation || raw.pix || raw.pixInformation || {};

  return {
    id: payment.id || payment.transaction_id || payment.transactionId || payment.reference || raw.id,
    status: payment.status || raw.status || 'pending',
    amount: payment.amount || raw.amount,
    currency: payment.currency || raw.currency || 'BRL',
    checkoutUrl: payment.checkout_url || payment.checkoutUrl || payment.payment_url || payment.url || raw.checkout_url,
    pendingActivation: Boolean(payment.pending_activation || payment.pendingActivation || raw.pending_activation),
    pixCode: pix.code || payment.pix_code || payment.pixCode || payment.qr_code || payment.qrCode || payment.copy_paste || payment.brcode || raw.pix_code,
    pixQrCodeImage: payment.pix_qr_code_image || payment.pixQrCodeImage || payment.qr_code_image || payment.qrCodeImage || payment.qrcode_base64 || raw.pix_qr_code_image,
    providerPayload: raw,
  };
}

async function requestJson(path, options = {}) {
  const session = await getSession();
  const accessToken = session?.access_token;
  const response = await fetch(`${getPaymentApiBase()}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...options.headers,
    },
    ...options,
  });

  const text = await response.text();
  let body = null;

  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { message: text };
    }
  }

  if (!response.ok) {
    throw new Error(body?.message || body?.error || `Erro no pagamento (${response.status})`);
  }

  return body;
}

export async function createCoinPurchase({ packageId, coins, bonus, amount, method, customer, billingAddress, cardData }) {
  const data = await requestJson('/coin-purchases', {
    method: 'POST',
    body: JSON.stringify({
      packageId,
      coins,
      bonus,
      amount,
      currency: 'BRL',
      method,
      customer,
      billingAddress,
      cardData,
      description: `${coins + bonus} moedas HOT Live`,
    }),
  });

  return normalizePaymentResponse(data);
}

export async function getPaymentConfiguration() {
  return requestJson('/configuration');
}

export async function getAdminPaymentReport(period = 30) {
  return requestJson(`/admin/report?period=${encodeURIComponent(period)}`);
}

export async function getPaymentStatus(paymentId) {
  const data = await requestJson(`/coin-purchases/${encodeURIComponent(paymentId)}`);
  return normalizePaymentResponse(data);
}

export function isPaidStatus(status) {
  return ['paid', 'approved', 'authorized', 'completed', 'confirmed', 'success'].includes(
    String(status || '').toLowerCase(),
  );
}

export function isFailedStatus(status) {
  return ['failed', 'canceled', 'cancelled', 'refused', 'rejected', 'expired'].includes(
    String(status || '').toLowerCase(),
  );
}
