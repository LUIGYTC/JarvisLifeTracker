import { GoogleAuth } from 'google-auth-library';
import { SPREADSHEET_ID } from './config.js';

export const MSI_RANGE = "'ComprasMSI'!A:H";
const header = ['Compra', 'Tarjeta', 'Mensualidad', 'Mes actual', 'Meses totales', 'Próximo corte', 'Estado', 'Nota'];
const invalid = () => { throw new Error('Invalid MSI data'); };
function number(value) {
  if (typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value.trim())) value = Number(value.trim());
  if (typeof value !== 'number' || !Number.isFinite(value)) invalid();
  return value;
}
function cutDate(value) {
  if (value == null || value === '') return null;
  if (Number.isInteger(value) && value >= 1 && value <= 2958465) value = new Date(Date.UTC(1899, 11, 30) + value * 86400000).toISOString().slice(0, 10);
  if (typeof value !== 'string') invalid();
  const local = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);
  if (local) value = `${local[3]}-${local[2].padStart(2, '0')}-${local[1].padStart(2, '0')}`;
  if (!/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) invalid();
  return value;
}
export function parseMSI(values = [], tarjeta) {
  if (!Array.isArray(values) || values.length > 10001 || values.some(row => !Array.isArray(row))) invalid();
  const rows = values.filter(row => !row.every(cell => cell == null || (typeof cell === 'string' && !cell.trim())));
  if (rows.length && !header.every((name, i) => rows[0][i] === name)) invalid();
  const compras = [];
  let totalCents = 0;
  for (const row of rows.slice(1)) {
    if (row[1] !== tarjeta || row[6] !== 'Activo') continue;
    const compra = row[0], monthly = number(row[2]), cents = Math.round(monthly * 100);
    const mesActual = number(row[3]), mesesTotales = number(row[4]);
    if (typeof compra !== 'string' || !compra.trim() || compra.length > 500 || /^\s*[=+@]/u.test(compra) ||
        !Number.isSafeInteger(cents) || cents <= 0 || Math.abs(monthly * 100 - cents) > 1e-7 ||
        !Number.isSafeInteger(mesActual) || !Number.isSafeInteger(mesesTotales) || mesActual < 1 || mesActual > mesesTotales) invalid();
    totalCents += cents;
    if (!Number.isSafeInteger(totalCents)) invalid();
    compras.push({ compra, mensualidad: cents / 100, mesActual, mesesTotales, proximoCorte: cutDate(row[5]) });
  }
  return { tarjeta, compras, totalMensualMSI: totalCents / 100 };
}

export function createMSIReader({ auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] }),
  fetchImpl = fetch, timeoutMs = 8000 } = {}) {
  return async tarjeta => {
    const controller = new AbortController();
    let timer;
    try {
      return await Promise.race([(async () => {
        const client = await auth.getClient();
        const headers = await client.getRequestHeaders();
        controller.signal.throwIfAborted();
        const url = new URL(`https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(MSI_RANGE)}`);
        url.search = new URLSearchParams({ valueRenderOption: 'UNFORMATTED_VALUE', dateTimeRenderOption: 'SERIAL_NUMBER', fields: 'values' });
        const response = await fetchImpl(url, { method: 'GET', headers, signal: controller.signal, cache: 'no-store', redirect: 'error' });
        if (response.status !== 200) invalid();
        return parseMSI((await response.json()).values, tarjeta);
      })(), new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('timeout')); }, timeoutMs); })]);
    } catch { throw new Error('MSI unavailable'); }
    finally { clearTimeout(timer); }
  };
}
