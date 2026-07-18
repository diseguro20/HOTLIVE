const API_BASE = import.meta.env.VITE_PLATFORM_API_BASE || '/api/platform';
const SESSION_KEY = 'hot_live_session';
const listeners = new Set();
let refreshPromise = null;

function readStoredSession() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
  } catch {
    localStorage.removeItem(SESSION_KEY);
    return null;
  }
}

function storeSession(session) {
  if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  else localStorage.removeItem(SESSION_KEY);
  listeners.forEach((listener) => listener(session));
  return session;
}

async function request(path, options = {}, token) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || 'Não foi possível concluir a solicitação.');
  return body;
}

export async function getSession() {
  const session = readStoredSession();
  if (!session?.access_token) return null;
  if (!session.expires_at || session.expires_at * 1000 > Date.now() + 60000) return session;
  if (!session.refresh_token) return storeSession(null);

  if (!refreshPromise) {
    refreshPromise = request('/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refreshToken: session.refresh_token }),
    }).then(({ session: nextSession }) => storeSession(nextSession))
      .catch(() => storeSession(null))
      .finally(() => { refreshPromise = null; });
  }
  return refreshPromise;
}

export function onSessionChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function signUp({ name, email, password }) {
  const data = await request('/auth/signup', {
    method: 'POST',
    body: JSON.stringify({ name, email, password }),
  });
  if (data.session) storeSession(data.session);
  return data;
}

export async function signIn({ email, password }) {
  const data = await request('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  storeSession(data.session);
  return data;
}

export async function signOut() {
  storeSession(null);
}

async function authenticatedRequest(path, options) {
  const session = await getSession();
  if (!session?.access_token) throw new Error('Entre na sua conta para continuar.');
  return request(path, options, session.access_token);
}

export async function getProfile() {
  const { profile } = await authenticatedRequest('/profile');
  return profile;
}

export async function updateProfile(changes) {
  const { profile } = await authenticatedRequest('/profile', {
    method: 'PATCH',
    body: JSON.stringify(changes),
  });
  return profile;
}

export async function createPrivateCallRequest(streamer) {
  const { call } = await authenticatedRequest('/private-calls', {
    method: 'POST',
    body: JSON.stringify({
      streamerId: String(streamer.id),
      streamerName: streamer.name || '',
      streamerAvatarUrl: streamer.avatar || streamer.image || null,
    }),
  });
  return call;
}

export async function updatePrivateCallRequest(callId, changes) {
  const { call } = await authenticatedRequest(`/private-calls/${encodeURIComponent(callId)}`, {
    method: 'PATCH',
    body: JSON.stringify(changes),
  });
  return call;
}
