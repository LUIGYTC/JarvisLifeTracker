// Public endpoints only. Never place identities or secrets in this file.
window.JarvisConfig = Object.freeze({
  // Production remains disabled until an explicit HTTPS backend is configured.
  apiBaseUrl: window.location.origin === 'http://localhost:8000' ? 'http://127.0.0.1:8080' : ''
});
