import { GoogleAuth } from 'google-auth-library';
import { SPREADSHEET_ID } from './config.js';

export const TARJETAS_RANGE = "'TarjetasCredito'!A:J";
const headers = ['Tarjeta', 'Tipo', 'Límite', 'Utilizado', 'Disponible', '% Utilización',
  'Día de corte', 'Última actualización', 'Fecha límite de pago', 'Domiciliada a'];
const invalid = () => { throw new Error('Invalid credit card data'); };
const empty = value => value == null || (typeof value === 'string' && !value.trim());
function label(value, optional = false) {
  if (optional && empty(value)) return null;
  if (typeof value !== 'string' || !value.trim() || value.length > 100 || /^\s*[=+@]/u.test(value)) invalid();
  return value.trim();
}
function decimal(value, currency = false) {
  if (typeof value === 'string') {
    value = value.trim();
    if (currency) value = value.replace(/^(?:MXN\s*|\$\s*)/i, '');
    if (!/^-?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(value)) invalid();
    value = Number(value.replaceAll(',', ''));
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) invalid();
  return value;
}
function money(value, signed = false) {
  value = decimal(value, true);
  const cents = Math.round(value * 100);
  if ((!signed && value < 0) || !Number.isSafeInteger(cents) || Math.abs(value * 100 - cents) > 1e-7) invalid();
  return cents === 0 ? 0 : cents / 100;
}
function percentage(value) {
  // Sheets UNFORMATTED_VALUE returns native percentages as ratios: 0.25 = 25%.
  const explicit = typeof value === 'string' && value.trim().endsWith('%');
  const raw = decimal(explicit ? value.trim().slice(0, -1).trim() : value);
  const points = explicit ? raw : raw * 100;
  if (points < 0 || !Number.isSafeInteger(Math.round(points * 100))) invalid();
  return Math.round(points * 100) / 100;
}
function date(value) {
  if (empty(value)) return null;
  if (typeof value === 'number' && value >= 1 && value < 2958466) {
    value = new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86400000).toISOString().slice(0, 10);
  }
  if (typeof value !== 'string') invalid();
  value = value.trim();
  const local = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);
  if (local) value = `${local[3]}-${local[2].padStart(2, '0')}-${local[1].padStart(2, '0')}`;
  if (!/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value)) invalid();
  const stamp = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(stamp) || new Date(stamp).toISOString().slice(0, 10) !== value) invalid();
  return value;
}
export function parseTarjetas(values = []) {
  if (!Array.isArray(values) || values.length > 10001) invalid();
  if (!values.length) return { tarjetas: [] };
  if (!headers.every((name, i) => values[0]?.[i] === name)) invalid();
  const tarjetas = [];
  for (const row of values.slice(1)) {
    try {
      if (!Array.isArray(row) || row.every(empty)) continue;
      const diaCorte = empty(row[6]) ? null : decimal(row[6]);
      if (diaCorte !== null && (!Number.isInteger(diaCorte) || diaCorte < 1 || diaCorte > 31)) invalid();
      tarjetas.push({ tarjeta: label(row[0]), tipo: label(row[1]), limite: money(row[2]),
        utilizado: money(row[3]), disponible: money(row[4], true), porcentajeUtilizacion: percentage(row[5]),
        diaCorte, ultimaActualizacion: date(row[7]), fechaLimitePago: date(row[8]), domiciliadaA: label(row[9], true) });
    } catch { /* Skip invalid rows without logging financial data. */ }
  }
  return { tarjetas };
}

export function createTarjetasReader({ auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] }),
  fetchImpl = fetch, timeoutMs = 8000 } = {}) {
  return async () => {
    const controller = new AbortController();
    let timer;
    try {
      return await Promise.race([(async () => {
        const client = await auth.getClient();
        const headers = await client.getRequestHeaders();
        controller.signal.throwIfAborted();
        const url = new URL(`https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(TARJETAS_RANGE)}`);
        url.search = new URLSearchParams({ valueRenderOption: 'UNFORMATTED_VALUE', dateTimeRenderOption: 'SERIAL_NUMBER', fields: 'values' });
        const response = await fetchImpl(url, { method: 'GET', headers, signal: controller.signal, cache: 'no-store', redirect: 'error' });
        if (response.status !== 200) invalid();
        return parseTarjetas((await response.json()).values);
      })(), new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('timeout')); }, timeoutMs); })]);
    } catch { throw new Error('Credit cards unavailable'); }
    finally { clearTimeout(timer); }
  };
}
