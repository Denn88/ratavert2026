// All real data now comes from the backend, which itself only knows what the
// Raspberry Pi reports. Nothing in this file fabricates data.

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000";
const WS_URL = import.meta.env.VITE_WS_URL || "ws://localhost:4000";

const TOKEN_KEY = "ratavert_token";
const USER_KEY = "ratavert_user";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}
export function getStoredUser() {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY) || "null");
  } catch {
    return null;
  }
}
export function storeSession(token, user) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}
export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

async function request(path, { method = "GET", body, auth = true } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (auth) {
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* empty response */
  }
  if (!res.ok) {
    const err = new Error((data && data.error) || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  login: (username, password) => request("/api/auth/login", { method: "POST", body: { username, password }, auth: false }),
  me: () => request("/api/me"),
  changePassword: (currentPassword, newPassword) => request("/api/auth/change-password", { method: "POST", body: { currentPassword, newPassword } }),

  // Multipart upload — no JSON content-type, browser sets the boundary itself.
  uploadCapture: async (blob) => {
    const form = new FormData();
    form.append("photo", blob, "capture.jpg");
    const res = await fetch(`${API_URL}/api/captures/photo`, {
      method: "POST",
      headers: { Authorization: `Bearer ${getToken()}` },
      body: form,
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error((data && data.error) || `Upload failed (${res.status})`);
    return data;
  },

  getStatus: () => request("/api/status"),
  getSettings: () => request("/api/settings"),
  updateSettings: (patch) => request("/api/settings", { method: "POST", body: patch }),

  connectDevice: (ip) => request("/api/device/connect", { method: "POST", body: { ip } }),
  disconnectDevice: () => request("/api/device/disconnect", { method: "POST" }),
  getInstallCommand: () => request("/api/device/install-command"),

  fireTrigger: (type, duration = 2) => request("/api/trigger", { method: "POST", body: { type, duration } }),

  getLogs: (opts = {}) => {
    const qs = new URLSearchParams(opts).toString();
    return request(`/api/logs${qs ? `?${qs}` : ""}`);
  },
  getDetections: (opts = {}) => {
    const qs = new URLSearchParams(opts).toString();
    return request(`/api/detections${qs ? `?${qs}` : ""}`);
  },
  getHourlyAnalytics: () => request("/api/analytics/hourly"),

  getAccounts: () => request("/api/accounts"),
  createAccount: (username, password, role) => request("/api/accounts", { method: "POST", body: { username, password, role } }),
  patchAccount: (username, patch) => request(`/api/accounts/${encodeURIComponent(username)}`, { method: "PATCH", body: patch }),

  photoUrl: (relOrAbs) => (relOrAbs && relOrAbs.startsWith("http") ? relOrAbs : `${API_URL}${relOrAbs}`),
};

// ── Real-time event stream ───────────────────────────────────────────────────
// Emits: 'detection' | 'trigger_ack' | 'trigger_requested' | 'status' | 'settings' | 'accounts_changed' | 'open' | 'close'
export function connectEvents(onEvent) {
  let socket = null;
  let closedByUser = false;
  let retryDelay = 1500;

  function open() {
    const token = getToken();
    if (!token) return;
    socket = new WebSocket(`${WS_URL}/ws/events?token=${encodeURIComponent(token)}`);
    socket.onopen = () => {
      retryDelay = 1500;
      onEvent({ type: "open" });
    };
    socket.onmessage = (msg) => {
      try {
        const parsed = JSON.parse(msg.data);
        onEvent(parsed);
      } catch {
        /* ignore malformed frame */
      }
    };
    socket.onclose = () => {
      onEvent({ type: "close" });
      if (!closedByUser) {
        setTimeout(open, retryDelay);
        retryDelay = Math.min(retryDelay * 1.6, 20000);
      }
    };
    socket.onerror = () => socket && socket.close();
  }
  open();

  return () => {
    closedByUser = true;
    socket && socket.close();
  };
}
