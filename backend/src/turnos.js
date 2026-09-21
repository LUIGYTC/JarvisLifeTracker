import { GoogleAuth } from 'google-auth-library';
import { SPREADSHEET_ID } from './config.js';

const invalid = () => { throw new Error('Invalid shift data'); };
const DAY = 86400000;
export function validDate(value) {
  if (typeof value !== 'string' || !/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value)) invalid();
  const stamp = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(stamp) || new Date(stamp).toISOString().slice(0, 10) !== value) invalid();
  return value;
}
export function shiftRange(params) {
  if ([...params.keys()].length !== 2 || !params.has('from') || !params.has('to')) invalid();
  const from = validDate(params.get('from')), to = validDate(params.get('to'));
  if (from > to || (Date.parse(to) - Date.parse(from)) / DAY > 61) invalid();
  return { from, to }; // At most 62 inclusive days.
}
function sheetDate(value) {
  if (Number.isInteger(value) && value > 0 && value <= 2958465) {
    value = new Date(Date.UTC(1899, 11, 30) + value * DAY).toISOString().slice(0, 10);
  }
  return validDate(value);
}
function time(value) {
  if (typeof value === 'number' && value >= 0 && value < 1) {
    const minutes = Math.round(value * 1440);
    if (Math.abs(value * 1440 - minutes) > 1e-7 || minutes >= 1440) invalid();
    value = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  }
  if (typeof value !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) invalid();
  return value;
}
function label(value, limit, optional = false) {
  if (optional && value == null) return '';
  if (typeof value !== 'string' || value.length > limit || (!optional && !value.trim()) || /^\s*=/u.test(value)) invalid();
  return value;
}
export function parseTurnos(values = [], { from, to }) {
  if (!Array.isArray(values) || values.length > 10001) invalid();
  if (!values.length) return { turnos: [] };
  const header = ['Fecha turno', 'Hora inicio', 'Hora fin', 'Tipo', 'Estado', 'Nota'];
  if (!header.every((name, i) => values[0]?.[i] === name)) invalid();
  const turnos = [];
  for (const row of values.slice(1)) {
    try {
      if (!Array.isArray(row) || row.every(cell => cell == null || cell === '')) continue;
      const fechaTurno = sheetDate(row[0]);
      if (fechaTurno < from || fechaTurno > to) continue;
      const horaInicio = time(row[1]), horaFin = time(row[2]);
      const tipo = label(row[3], 100), estado = label(row[4], 50), nota = label(row[5], 500, true);
      const startDate = horaFin <= horaInicio
        ? validDate(new Date(Date.parse(fechaTurno) - DAY).toISOString().slice(0, 10)) : fechaTurno;
      turnos.push({ fechaTurno, horaInicio, horaFin, tipo, estado, nota,
        inicioReal: `${startDate}T${horaInicio}:00`, finReal: `${fechaTurno}T${horaFin}:00` });
    } catch { /* Skip malformed rows without logging private cells. */ }
  }
  return { turnos: turnos.sort((a, b) => a.fechaTurno.localeCompare(b.fechaTurno) || a.horaInicio.localeCompare(b.horaInicio)) };
}
export function createTurnosReader({ auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] }),
  fetchImpl = fetch, timeoutMs = 8000 } = {}) {
  return async range => {
    const controller = new AbortController();
    let timer;
    try {
      return await Promise.race([(async () => {
        const client = await auth.getClient();
        const headers = await client.getRequestHeaders();
        controller.signal.throwIfAborted();
        const url = new URL(`https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent("'Turnos'!A:F")}`);
        url.search = new URLSearchParams({ valueRenderOption: 'FORMULA', dateTimeRenderOption: 'SERIAL_NUMBER', fields: 'values' });
        const response = await fetchImpl(url, { method: 'GET', headers, signal: controller.signal, cache: 'no-store', redirect: 'error' });
        if (response.status !== 200) invalid();
        return parseTurnos((await response.json()).values, range);
      })(), new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('timeout')); }, timeoutMs); })]);
    } catch { throw new Error('Turnos unavailable'); }
    finally { clearTimeout(timer); }
  };
}
