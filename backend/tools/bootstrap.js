// Development only. This entire directory is excluded from the container.
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { GOOGLE_CLIENT_ID } from '../src/config.js';
import { bearerToken, reply } from '../src/app.js';
import { createVerifier } from '../src/verify.js';

export function assertBootstrapAllowed(env, args, isTTY) {
  if (env.NODE_ENV !== 'development' || env.K_SERVICE || env.K_REVISION ||
      env.CLOUD_RUN_JOB || env.CI || !isTTY || !args.includes('--discover-sub')) {
    throw new Error('Bootstrap requires explicit interactive local development');
  }
}

export function createBootstrapServer({ verify = createVerifier(), onVerified } = {}) {
  const nonce = randomBytes(32).toString('hex');
  const route = `/discover-${nonce}`;
  let completed = false;
  let busy = false;
  const server = http.createServer({ maxHeaderSize: 16384, requestTimeout: 15000 }, async (req, res) => {
    if (req.headers.host !== 'localhost:8000' || req.url !== route || completed) {
      return reply(res, 404, { error: 'not_found' });
    }
    if (req.method === 'GET') {
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}' https://accounts.google.com/gsi/client; frame-src https://accounts.google.com; connect-src 'self' https://accounts.google.com; style-src 'unsafe-inline' https://accounts.google.com; img-src https://accounts.google.com https://*.googleusercontent.com; frame-ancestors 'none'; base-uri 'none'`
      });
      res.end(`<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Jarvis: descubrimiento local</title><h1>Descubrir identificador local</h1>
<p>Inicia sesión con la cuenta que deseas autorizar. Esto no concede acceso a Jarvis.</p>
<div id="google"></div><p id="status" role="status">Cargando Google…</p>
<script nonce="${nonce}">
window.onGoogleLibraryLoad = () => {
  google.accounts.id.initialize({ client_id: '${GOOGLE_CLIENT_ID}', auto_select: false, ux_mode: 'popup',
    callback: async response => {
      let token = response.credential;
      const status = document.getElementById('status');
      if (typeof token !== 'string' || !token) { status.textContent = 'No se recibió identidad.'; return; }
      try {
        status.textContent = 'Validando con Google…';
        const result = await fetch('${route}', { method: 'POST',
          headers: { Authorization: 'Bearer ' + token, 'X-Bootstrap-Nonce': '${nonce}' },
          credentials: 'omit', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(12000) });
        status.textContent = result.status === 200 ? 'Identidad verificada. Consulta únicamente tu terminal local. Cierra esta pestaña.' : 'No se pudo verificar. No se autorizó ninguna cuenta.';
      } catch { status.textContent = 'Error de conexión. Reinicia la herramienta si es necesario.'; }
      finally { token = null; }
    }
  });
  google.accounts.id.renderButton(document.getElementById('google'), { type: 'standard', theme: 'outline', size: 'large' });
  document.getElementById('status').textContent = 'Herramienta temporal; al terminar cierra esta pestaña.';
};
</script><script nonce="${nonce}" src="https://accounts.google.com/gsi/client?hl=es" async></script></html>`);
      return;
    }
    if (req.method !== 'POST' || req.headers.origin !== 'http://localhost:8000' ||
        req.headers['x-bootstrap-nonce'] !== nonce || busy) {
      return reply(res, 403, { error: 'denied' });
    }
    const token = bearerToken(req);
    if (!token) return reply(res, 401, { error: 'invalid_identity' });
    if (req.headers['transfer-encoding'] || Number(req.headers['content-length'] || 0) > 0) {
      return reply(res, 400, { error: 'body_not_allowed' });
    }
    busy = true;
    let timer;
    try {
      const sub = await Promise.race([verify(token), new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), 10000);
      })]);
      if (completed) return reply(res, 410, { error: 'closed' });
      completed = true;
      onVerified(sub); // Only the explicit CLI prints this privately to its terminal.
      reply(res, 200, { ok: true });
      server.close();
    } catch {
      reply(res, 401, { error: 'invalid_identity' });
    } finally {
      busy = false;
      clearTimeout(timer);
    }
  });
  return { server, route };
}
