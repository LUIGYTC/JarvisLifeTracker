import { GoogleAuth } from 'google-auth-library';
import { SPREADSHEET_ID } from './config.js';

// Server-only source. Never accept a range or spreadsheet from the request.
export const DASHBOARD_RANGE = "'Movimientos'!A:G";
const headers = ['Fecha', 'Hora', 'Tipo', 'Categoría', 'Monto', 'Descripción', 'Método'];
const invalid = () => { throw new Error('Invalid dashboard data'); };
export function dateText(value) {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 2958465) {
    value = new Date(Date.UTC(1899, 11, 30) + value * 86400000).toISOString().slice(0, 10);
  }
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) invalid();
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) invalid();
  return value;
}
function timeText(value) {
  if (typeof value === 'number' && value >= 0 && value < 1) {
    const minutes = Math.round(value * 1440);
    if (Math.abs(value * 1440 - minutes) > 1e-7 || minutes >= 1440) invalid();
    value = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  }
  if (typeof value !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) invalid();
  return value;
}
function text(value, limit) {
  if (typeof value !== 'string' || !value.trim() || value.length > limit || /^\s*[=+@＝＋＠]/u.test(value)) invalid();
  return value;
}
export function aggregateDashboard(values = []) {
  if (!Array.isArray(values) || values.length > 10001) invalid();
  if (values.some(row => !Array.isArray(row))) invalid();
  values = values.filter(row => !row.every(cell => cell == null || (typeof cell === 'string' && !cell.trim())));
  if (!values.length) return { summary: { ingresos: 0, gastos: 0, balance: 0, movimientos: 0 }, byCategory: [], byPaymentMethod: [], daily: [], recent: [] };
  if (!headers.every((name, i) => values[0]?.[i] === name)) invalid();
  const categories = new Map(), methods = new Map(), days = new Map(), recent = [];
  let ingresos = 0, gastos = 0;
  const add = (a, b) => { const result = a + b; if (!Number.isSafeInteger(result)) invalid(); return result; };
  for (const row of values.slice(1)) {
    if (!Array.isArray(row)) invalid();
    if (row.every(cell => cell === '' || cell == null)) continue;
    const [fecha, hora, tipo, categoria, monto, descripcion, metodo] = row;
    if (!['Ingreso', 'Gasto'].includes(tipo) || typeof monto !== 'number' || !Number.isFinite(monto) || monto <= 0) invalid();
    const cents = Math.round(monto * 100);
    if (!Number.isSafeInteger(cents) || cents <= 0 || Math.abs(monto * 100 - cents) > 1e-7) invalid();
    const item = { fecha: dateText(fecha), hora: timeText(hora), tipo,
      categoria: text(categoria, 100), monto: cents / 100, descripcion: text(descripcion, 500), metodo: text(metodo, 100) };
    recent.push(item);
    const day = days.get(item.fecha) || { fecha: item.fecha, ingresos: 0, gastos: 0 };
    if (tipo === 'Ingreso') { ingresos = add(ingresos, cents); day.ingresos = add(day.ingresos, cents); }
    else {
      gastos = add(gastos, cents); day.gastos = add(day.gastos, cents);
      categories.set(categoria, add(categories.get(categoria) || 0, cents));
      methods.set(metodo, add(methods.get(metodo) || 0, cents));
    }
    days.set(item.fecha, day);
  }
  const grouped = (map, key) => [...map].map(([name, total]) => ({ [key]: name, total: total / 100 }))
    .sort((a, b) => b.total - a.total || a[key].localeCompare(b[key]));
  return { summary: { ingresos: ingresos / 100, gastos: gastos / 100, balance: (ingresos - gastos) / 100, movimientos: recent.length },
    byCategory: grouped(categories, 'categoria'), byPaymentMethod: grouped(methods, 'metodo'),
    daily: [...days.values()].sort((a, b) => a.fecha.localeCompare(b.fecha)).map(day => ({ ...day, ingresos: day.ingresos / 100, gastos: day.gastos / 100 })),
    recent: recent.sort((a, b) => (b.fecha + b.hora).localeCompare(a.fecha + a.hora)).slice(0, 20) };
}

export function createDashboardReader({ auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] }),
  fetchImpl = fetch, timeoutMs = 8000, aggregate = aggregateDashboard } = {}) {
  return async () => {
    const controller = new AbortController();
    let timer;
    try {
      return await Promise.race([(async () => {
        const client = await auth.getClient();
        const headers = await client.getRequestHeaders();
        controller.signal.throwIfAborted();
        const url = new URL(`https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(DASHBOARD_RANGE)}`);
        url.search = new URLSearchParams({ valueRenderOption: 'FORMULA', dateTimeRenderOption: 'SERIAL_NUMBER', fields: 'values' });
        const response = await fetchImpl(url, { method: 'GET', headers, signal: controller.signal, cache: 'no-store', redirect: 'error' });
        if (response.status !== 200) invalid();
        const data = await response.json();
        return aggregate(data.values);
      })(), new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('timeout')); }, timeoutMs); })]);
    } catch { throw new Error('Dashboard unavailable'); }
    finally { clearTimeout(timer); }
  };
}
