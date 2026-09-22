import http from 'node:http';
import { ALLOWED_ORIGINS } from './config.js';
import { createVerifier } from './verify.js';
import { createSheetsCheck } from './sheets.js';
import { createDashboardReader } from './dashboard.js';
import { createTarjetasReader } from './tarjetas-credito.js';
import { createCardMovementsReader, tarjetaSelection } from './tarjeta-movimientos.js';
import { createTurnosReader, shiftRange } from './turnos.js';
import { createMovementWriter } from './sheets-write.js';
import { movimientoRow, readMovementBody } from './movimientos.js';

export function reply(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer'
  });
  res.end(body === undefined ? undefined : JSON.stringify(body));
}

export function bearerToken(req) {
  if ((req.headersDistinct.authorization || []).length !== 1) return null;
  const match = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i.exec(req.headers.authorization || '');
  return match && match[1].length <= 12000 ? match[1] : null;
}

export function createApp({ authorizedSub = '', verify = createVerifier(), verificationTimeoutMs = 10000,
  checkSheets = createSheetsCheck(), writeMovement = createMovementWriter(), readDashboard = createDashboardReader(), readTurnos = createTurnosReader(),
  readTarjetas = createTarjetasReader(), readCardMovements = createCardMovementsReader() } = {}) {
  const server = http.createServer({ maxHeaderSize: 16384, requestTimeout: 15000, headersTimeout: 10000 }, async (req, res) => {
    try {
      res.setHeader('Vary', 'Origin');
      const origin = req.headers.origin;
      if (origin !== undefined && !ALLOWED_ORIGINS.has(origin)) {
        return reply(res, 403, { error: 'origin_not_allowed' });
      }
      if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
      const turnosRoute = req.url.split('?')[0] === '/api/turnos';
      const cardMovementsRoute = req.url.split('?')[0] === '/api/tarjetas-credito/movimientos';
      const method = turnosRoute || cardMovementsRoute ? 'GET' : ['/auth/me', '/api/movimientos'].includes(req.url) ? 'POST'
        : ['/health', '/api/sheets/status', '/api/dashboard', '/api/tarjetas-credito'].includes(req.url) ? 'GET' : null;
      if (!method) return reply(res, 404, { error: 'not_found' });
      if (req.method === 'OPTIONS') {
        const requested = (req.headers['access-control-request-headers'] || '')
          .split(',').map(value => value.trim().toLowerCase()).filter(Boolean);
        if (!origin || req.headers['access-control-request-method'] !== method ||
            requested.some(value => value !== 'authorization' && value !== 'content-type')) {
          return reply(res, 403, { error: 'preflight_denied' });
        }
        res.setHeader('Vary', 'Origin, Access-Control-Request-Method, Access-Control-Request-Headers');
        res.setHeader('Access-Control-Allow-Methods', method);
        res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
        return reply(res, 204);
      }
      if (req.method !== method) {
        res.setHeader('Allow', `${method}, OPTIONS`);
        return reply(res, 405, { error: 'method_not_allowed' });
      }
      if (req.url === '/health') return reply(res, 200, { ok: true });
      const token = bearerToken(req);
      if (!token) return reply(res, 401, { error: 'invalid_identity' });
      // Authorization header only: no tokens accepted from request bodies or URLs.
      if (req.url !== '/api/movimientos' && (req.headers['transfer-encoding'] || Number(req.headers['content-length'] || 0) > 0)) {
        return reply(res, 400, { error: 'body_not_allowed' });
      }
      let sub;
      let timer;
      try {
        sub = await Promise.race([
          verify(token),
          new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), verificationTimeoutMs); })
        ]);
      } catch {
        // Never log the library error: it can include the JWT or claims.
        return reply(res, 401, { error: 'invalid_identity' });
      } finally {
        clearTimeout(timer);
      }
      if (!authorizedSub) return reply(res, 503, { error: 'authorization_unavailable' });
      if (sub !== authorizedSub) return reply(res, 403, { error: 'not_authorized' });
      if (turnosRoute) {
        let range;
        try { range = shiftRange(new URL(req.url, 'http://localhost').searchParams); }
        catch { return reply(res, 400, { error: 'invalid_range' }); }
        try { return reply(res, 200, await readTurnos(range)); }
        catch { return reply(res, 503, { error: 'turnos_unavailable' }); }
      }
      if (req.url === '/api/dashboard') {
        try { return reply(res, 200, await readDashboard()); }
        catch { return reply(res, 503, { error: 'dashboard_unavailable' }); }
      }
      if (cardMovementsRoute) {
        let tarjeta;
        try { tarjeta = tarjetaSelection(new URL(req.url, 'http://localhost').searchParams); }
        catch { return reply(res, 400, { error: 'invalid_selection' }); }
        try {
          const { tarjetas } = await readTarjetas();
          if (!tarjetas.some(card => card.tarjeta === tarjeta)) return reply(res, 404, { error: 'card_not_found' });
          return reply(res, 200, await readCardMovements(tarjeta));
        } catch { return reply(res, 503, { error: 'card_movements_unavailable' }); }
      }
      if (req.url === '/api/tarjetas-credito') {
        try { return reply(res, 200, await readTarjetas()); }
        catch { return reply(res, 503, { error: 'tarjetas_unavailable' }); }
      }
      if (req.url === '/api/movimientos') {
        if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type'] || '') ||
            req.headers['content-encoding']) return reply(res, 415, { error: 'unsupported_media_type' });
        let movement;
        try {
          movement = await readMovementBody(req);
          movimientoRow(movement);
        } catch (error) {
          res.setHeader('Connection', 'close');
          return reply(res, error.status || 400, { error: 'invalid_movement' });
        }
        try {
          const result = await writeMovement(movement);
          if (result !== true && result !== 'duplicate') throw new Error('Write failed');
          return reply(res, 200, result === 'duplicate' ? { registered: true, duplicate: true } : { registered: true });
        } catch (error) {
          return error.code === 'OPERATION_PENDING'
            ? reply(res, 409, { error: 'operation_pending' })
            : reply(res, 503, { error: 'movement_unavailable' });
        }
      }
      if (req.url === '/api/sheets/status') {
        try {
          if (await checkSheets() !== true) throw new Error('Sheets unavailable');
          return reply(res, 200, { connected: true });
        } catch {
          return reply(res, 503, { error: 'sheets_unavailable' });
        }
      }
      return reply(res, 200, { authenticated: true, authorized: true });
    } catch {
      if (!res.headersSent) reply(res, 500, { error: 'internal_error' });
      else res.end();
    }
  });
  // Avoid default diagnostic output containing malformed request material.
  server.on('clientError', (_, socket) => {
    socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nCache-Control: no-store\r\nContent-Length: 0\r\n\r\n');
  });
  return server;
}
