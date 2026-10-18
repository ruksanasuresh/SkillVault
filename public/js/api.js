// public/js/api.js
// Thin fetch wrapper: attaches the JWT, throws on non-2xx with the server's
// error message, and centralizes the base URL (same origin, so '').

const API = {
  base: '',

  token() { return localStorage.getItem('sv_token'); },
  setToken(t) { localStorage.setItem('sv_token', t); },
  clearToken() { localStorage.removeItem('sv_token'); },
  user() { try { return JSON.parse(localStorage.getItem('sv_user') || 'null'); } catch { return null; } },
  setUser(u) { localStorage.setItem('sv_user', JSON.stringify(u)); },

  async request(path, { method = 'GET', body, isForm = false } = {}) {
    const headers = {};
    const token = this.token();
    if (token) headers.Authorization = `Bearer ${token}`;
    if (!isForm && body) headers['Content-Type'] = 'application/json';

    const res = await fetch(this.base + path, {
      method,
      headers,
      body: isForm ? body : body ? JSON.stringify(body) : undefined,
    });

    let data = null;
    try { data = await res.json(); } catch { /* no body */ }

    if (!res.ok) {
      const message = (data && data.error) || `Request failed (${res.status})`;
      throw new Error(message);
    }
    return data;
  },

  get(path) { return this.request(path); },
  post(path, body) { return this.request(path, { method: 'POST', body }); },
  put(path, body) { return this.request(path, { method: 'PUT', body }); },
  del(path) { return this.request(path, { method: 'DELETE' }); },
  postForm(path, formData) { return this.request(path, { method: 'POST', body: formData, isForm: true }); },

  // fetches a protected file (certificate) as a blob and opens it in a new tab
  async openFile(path) {
    const token = this.token();
    const res = await fetch(this.base + path, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!res.ok) throw new Error('Could not load file');
    const blob = await res.blob();
    window.open(URL.createObjectURL(blob), '_blank');
  },
};

// Redirect to login if a protected page is opened without a session.
function requireAuthOrRedirect() {
  if (!API.token()) {
    window.location.href = 'login.html';
    return false;
  }
  return true;
}
