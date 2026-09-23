import { createHash } from 'node:crypto';
import { GoogleAuth } from 'google-auth-library';
import { SPREADSHEET_ID } from './config.js';
import { dateText } from './dashboard.js';
import { mexicoToday } from './proximo-corte.js';
import { movimientoRow } from './movimientos.js';
import { createMovementWriter } from './sheets-write.js';

export const COMMITMENTS_RANGE = "'Compromisos'!A:H";
const headers = ['Compromiso', 'Tipo', 'Monto', 'Frecuencia', 'Próxima fecha de pago', 'Método', 'Estado', 'Último pago'];
const blank = value => value == null || (typeof value === 'string' && !value.trim());
const normalize = value => typeof value === 'string' ? value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('es-MX') : '';
const failure = code => Object.assign(new Error('Commitments unavailable'), { code });
function sheetDate(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return dateText(Math.floor(value));
  if (typeof value !== 'string') throw failure('fecha_invalida');
  value = value.trim();
  const local = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);
  return dateText(local ? `${local[3]}-${local[2].padStart(2, '0')}-${local[1].padStart(2, '0')}` : value);
}
function table(values = []) {
  if (!Array.isArray(values) || values.length > 10001 || values.some(row => !Array.isArray(row))) throw failure('datos_invalidos');
  if (!values.length) return [];
  if (!headers.every((value, index) => values[0]?.[index] === value)) throw failure('encabezados_invalidos');
  return values.slice(1).map((cells, index) => ({ cells, row: index + 2 })).filter(item => !item.cells.every(blank));
}

export function commitmentOperationId(name, scheduledDate) {
  // Stable across retries/restarts and changes to amount or method. The UUID
  // envelope preserves the existing writer contract; its content is a hash.
  const bytes = createHash('sha256').update(JSON.stringify(['jarvis-compromiso-v1', SPREADSHEET_ID, normalize(name), dateText(scheduledDate)])).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function nextCommitmentDate(scheduledDate, frequency, lastPayment = null) {
  dateText(scheduledDate);
  const date = new Date(`${scheduledDate}T00:00:00Z`);
  const rule = normalize(frequency);
  const days = new Map([['diario', 1], ['semanal', 7], ['catorcenal', 14]]).get(rule);
  if (days) date.setUTCDate(date.getUTCDate() + days);
  else if (rule === 'mensual') {
    // Recover 29/30/31 after a short month using the prior scheduled payment.
    // Último pago is the processed scheduled date, not the execution timestamp.
    let targetDay = date.getUTCDate();
    if (lastPayment) {
      const previous = new Date(`${dateText(lastPayment)}T00:00:00Z`);
      const endOfMonth = new Date(date); endOfMonth.setUTCMonth(endOfMonth.getUTCMonth() + 1, 0);
      const adjacent = date.getUTCFullYear() * 12 + date.getUTCMonth() - previous.getUTCFullYear() * 12 - previous.getUTCMonth() === 1;
      if (adjacent && targetDay === endOfMonth.getUTCDate()) targetDay = Math.max(targetDay, previous.getUTCDate());
    }
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth() + 1;
    date.setUTCDate(1); date.setUTCFullYear(year, month, 1);
    const end = new Date(date); end.setUTCMonth(end.getUTCMonth() + 1, 0);
    date.setUTCDate(Math.min(targetDay, end.getUTCDate()));
  } else throw failure('frecuencia_no_soportada');
  return dateText(date.toISOString().slice(0, 10));
}

export function planCommitment(cells, today) {
  if (cells[6] !== 'Activo') return { estado: 'omitido', motivo: 'inactivo' };
  if (normalize(cells[1]) === 'regla operativa' || normalize(cells[0]) === 'pago de tarjetas') return { estado: 'omitido', motivo: 'regla_operativa' };
  if (typeof cells[0] !== 'string' || !cells[0].trim() || cells[0].length > 100 || blank(cells[1])) return { estado: 'no_procesable', motivo: 'compromiso_invalido' };
  if (blank(cells[4])) return { estado: 'no_procesable', motivo: 'fecha_faltante' };
  let scheduledDate;
  try { scheduledDate = sheetDate(cells[4]); } catch { return { estado: 'no_procesable', motivo: 'fecha_no_confirmada' }; }
  if (scheduledDate > today) return { estado: 'omitido', motivo: 'futuro' };
  if (blank(cells[2])) return { estado: 'no_procesable', motivo: 'monto_faltante' };
  const cents = Math.round(cells[2] * 100);
  if (typeof cells[2] !== 'number' || cells[2] <= 0 || !Number.isSafeInteger(cents) || Math.abs(cells[2] * 100 - cents) > 1e-7) return { estado: 'no_procesable', motivo: 'monto_invalido' };
  if (typeof cells[5] !== 'string' || !cells[5].trim() || cells[5].length > 100) return { estado: 'no_procesable', motivo: 'metodo_faltante' };
  let lastPayment = null, nextDate;
  try {
    if (!blank(cells[7])) lastPayment = sheetDate(cells[7]);
    if (lastPayment && lastPayment >= scheduledDate) return { estado: 'no_procesable', motivo: 'ultimo_pago_inconsistente' };
    nextDate = nextCommitmentDate(scheduledDate, cells[3], lastPayment);
  } catch (error) { return { estado: 'no_procesable', motivo: error.code === 'frecuencia_no_soportada' ? error.code : 'calendario_invalido' }; }
  const operationId = commitmentOperationId(cells[0], scheduledDate);
  const movement = { operationId, fecha: scheduledDate, hora: '00:00', tipo: 'Gasto', categoria: 'Servicios',
    monto: cells[2], descripcion: cells[0], metodo: cells[5], destino: '', origen: 'Jarvis',
    textoOriginal: `Generado automáticamente desde Compromisos. Fecha programada: ${scheduledDate}. Referencia: ${operationId}.` };
  movimientoRow(movement);
  return { estado: 'listo', scheduledDate, nextDate, movement };
}

export function createCommitmentStore({ auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/spreadsheets'] }), fetchImpl = fetch, timeoutMs = 8000 } = {}) {
  async function call(path, method = 'GET', body) {
    const controller = new AbortController(); let timer;
    try {
      return await Promise.race([(async () => {
        const client = await auth.getClient(), headers = new Headers(await client.getRequestHeaders());
        if (body) headers.set('Content-Type', 'application/json');
        controller.signal.throwIfAborted();
        const response = await fetchImpl(new URL(`https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}${path}`),
          { method, headers, ...(body ? { body: JSON.stringify(body) } : {}), signal: controller.signal, redirect: 'error', cache: 'no-store' });
        if (response.status !== 200) throw failure('sheets_unavailable');
        return response.json();
      })(), new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(failure('sheets_unavailable')); }, timeoutMs); })]);
    } catch { throw failure('sheets_unavailable'); }
    finally { clearTimeout(timer); }
  }
  async function read(range = COMMITMENTS_RANGE, render = 'UNFORMATTED_VALUE') {
    const data = await call(`/values/${encodeURIComponent(range)}?${new URLSearchParams({ valueRenderOption: render, dateTimeRenderOption: 'SERIAL_NUMBER', fields: 'values' })}`);
    if (data.values !== undefined && !Array.isArray(data.values)) throw failure('datos_invalidos');
    return data.values ?? [];
  }
  function matches(a, b) { return headers.every((_, index) => (a[index] ?? '') === (b[index] ?? '')); }
  async function locate(expected) {
    const found = table(await read()).filter(item => normalize(item.cells[0]) === normalize(expected[0]));
    if (found.length !== 1 || !matches(found[0].cells, expected)) throw failure('compromiso_cambiado');
    return found[0];
  }
  async function writable(expected) {
    const current = await locate(expected);
    // Only E and H will be changed; formulas in either are never overwritten.
    const formulas = await read(`'Compromisos'!E${current.row}:H${current.row}`, 'FORMULA');
    if (!Array.isArray(formulas[0]) || [formulas[0][0], formulas[0][3]].some(value => typeof value === 'string' && value.startsWith('='))) throw failure('fecha_con_formula');
    return current;
  }
  return Object.freeze({ read,
    async prepare(expected) { await writable(expected); },
    async advance(expected, scheduledDate, nextDate) {
      const current = await writable(expected);
      const serial = value => (Date.parse(`${value}T00:00:00Z`) - Date.UTC(1899, 11, 30)) / 86400000;
      const data = [
        { range: `'Compromisos'!E${current.row}`, majorDimension: 'ROWS', values: [[serial(nextDate)]] },
        { range: `'Compromisos'!H${current.row}`, majorDimension: 'ROWS', values: [[serial(scheduledDate)]] }
      ];
      const response = await call('/values:batchUpdate', 'POST', { valueInputOption: 'RAW', includeValuesInResponse: false, data });
      if (response.totalUpdatedCells !== 2) throw failure('actualizacion_no_confirmada');
      const updated = table(await read()).filter(item => normalize(item.cells[0]) === normalize(expected[0]));
      if (updated.length !== 1 || sheetDate(updated[0].cells[4]) !== nextDate || sheetDate(updated[0].cells[7]) !== scheduledDate ||
          ![0, 1, 2, 3, 5, 6].every(index => updated[0].cells[index] === expected[index])) throw failure('actualizacion_no_confirmada');
      return updated[0].cells;
    }
  });
}

export function createCommitmentProcessor({ store = createCommitmentStore(), writeMovement = createMovementWriter(), now = () => new Date(), maxOccurrences = 50 } = {}) {
  if (!Number.isInteger(maxOccurrences) || maxOccurrences < 1 || maxOccurrences > 100) throw failure('limite_invalido');
  let running = false;
  return async () => {
    if (running) throw failure('PROCESSOR_BUSY');
    running = true;
    try {
      const today = mexicoToday(now()), entries = table(await store.read());
      const counts = new Map();
      for (const { cells } of entries) counts.set(normalize(cells[0]), (counts.get(normalize(cells[0])) || 0) + 1);
      const resultados = [];
      let attempts = 0, limitReached = false;
      for (const entry of entries) {
        let cells = entry.cells;
        const name = typeof cells[0] === 'string' ? cells[0].slice(0, 100) : '';
        let processed = false;
        while (true) {
          const plan = planCommitment(cells, today);
          if (plan.estado !== 'listo') {
            if (!processed || plan.estado === 'no_procesable') resultados.push({ compromiso: name, ...plan });
            break;
          }
          if (counts.get(normalize(cells[0])) !== 1) { resultados.push({ compromiso: name, estado: 'no_procesable', motivo: 'nombre_duplicado' }); break; }
          if (attempts >= maxOccurrences) { limitReached = true; resultados.push({ compromiso: name, estado: 'pendiente', motivo: 'limite_ejecucion' }); break; }
          attempts++;
          let saved = false;
          try {
            await store.prepare(cells);
            const result = await writeMovement(plan.movement);
            if (result !== true && result !== 'duplicate') throw failure('registro_no_confirmado');
            saved = true;
            cells = await store.advance(cells, plan.scheduledDate, plan.nextDate);
            resultados.push({ compromiso: name, fechaProgramada: plan.scheduledDate, proximaFecha: plan.nextDate,
              estado: result === 'duplicate' ? 'recuperado' : 'procesado' });
            processed = true;
          } catch (error) {
            const motivo = saved ? 'movimiento_registrado_fechas_pendientes' : error.code === 'OPERATION_PENDING' ? 'operacion_pendiente_revision'
              : ['compromiso_cambiado', 'fecha_con_formula'].includes(error.code) ? error.code : 'registro_no_confirmado';
            resultados.push({ compromiso: name, fechaProgramada: plan.scheduledDate, estado: 'no_procesable', motivo });
            break;
          }
        }
      }
      return { fecha: today, limiteAlcanzado: limitReached, resultados };
    } finally { running = false; }
  };
}
