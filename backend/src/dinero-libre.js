import { GoogleAuth } from 'google-auth-library';
import { SPREADSHEET_ID } from './config.js';
import { aggregateAvailableMoney, DEBIT_RANGES } from './dinero-disponible.js';
import { dateText } from './dashboard.js';
import { mexicoToday } from './proximo-corte.js';

// Fixed read-only sources. Never read credit utilization, forecasts or MSI.
export const FREE_MONEY_RANGES = [...DEBIT_RANGES, "'Compromisos'!A:H", "'CortesTarjeta'!A:E", "'CortesTarjeta'!H:M", "'Movimientos'!A:G"];
const invalid = () => { throw Error('Invalid free money data'); };
const blank = value => value == null || (typeof value === 'string' && !value.trim());
const label = value => { if (typeof value !== 'string' || !value.trim() || value.length > 500) invalid(); return value.trim(); };
function cents(value, signed = false) {
  const result = Math.round(value * 100);
  if (typeof value !== 'number' || !Number.isFinite(value) || (!signed && value < 0) || !Number.isSafeInteger(result) || Math.abs(value * 100 - result) > 1e-7) invalid();
  return result;
}
function sum(values) {
  return values.reduce((total, value) => { const next = total + value; if (!Number.isSafeInteger(next)) invalid(); return next; }, 0);
}
function rows(values = [], headers) {
  if (!Array.isArray(values) || values.length > 10001 || values.some(row => !Array.isArray(row))) invalid();
  if (!values.length) return [];
  if (!headers.every((header, i) => values[0]?.[i] === header)) invalid();
  return values.slice(1);
}
const shift = (date, days) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
export function fortnight(today, anchor) {
  dateText(today); dateText(anchor);
  const elapsed = Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${anchor}T00:00:00Z`)) / 86400000);
  const inicio = shift(anchor, Math.floor(elapsed / 14) * 14);
  return { inicio, fin: shift(inicio, 13) };
}

export function calculateFreeMoney({ available, commitments = [], cutDates = [], cutAmounts = [], movements = [], today, anchor = '' }) {
  const disponible = cents(available.total, true);
  dateText(today);
  const pendientes = [];
  const issue = (codigo, nombre = '') => { if (!pendientes.some(item => item.codigo === codigo && item.nombre === nombre)) pendientes.push({ codigo, nombre }); };
  let periodo = null;
  try { periodo = fortnight(today, anchor); } catch { issue('periodo_sin_confirmar'); }
  const debits = new Set(available.cuentas.map(account => account.nombre));
  const expenses = rows(movements, ['Fecha', 'Hora', 'Tipo', 'Categoría', 'Monto', 'Descripción', 'Método'])
    .filter(row => !row.every(blank)).map(row => {
      const fecha = dateText(row[0]);
      if (!['Ingreso', 'Gasto'].includes(row[2])) invalid();
      cents(row[4]);
      return { fecha, tipo: row[2], metodo: label(row[6]) };
    }).filter(row => row.tipo === 'Gasto' && row.fecha <= today);
  const compromisos = [], cortes = [];
  const seenCommitments = new Set();
  for (const row of rows(commitments, ['Compromiso', 'Tipo', 'Monto', 'Frecuencia', 'Día / regla', 'Método', 'Estado', 'Último pago'])) {
    if (row.every(blank)) continue;
    const nombre = label(row[0]), estado = label(row[6]);
    if (estado === 'Inactivo') continue;
    if (seenCommitments.has(nombre)) { issue('compromiso_duplicado', nombre); continue; }
    seenCommitments.add(nombre);
    if (!['Activo', 'Pendiente', 'Pagado'].includes(estado)) { issue('estado_compromiso', nombre); continue; }
    const montoMensual = cents(row[2]);
    const rule = typeof row[4] === 'string' ? row[4].trim() : '';
    const saving = /^(?:\$\s*)?(\d+(?:,\d{3})*(?:\.\d{1,2})?) por catorcena$/i.exec(rule);
    const due = /^Día ([1-9]|[12]\d|3[01])$/i.exec(rule);
    if (row[3] !== 'Mensual' || (!saving && !due)) { issue('regla_sin_confirmar', nombre); continue; }
    if (!periodo) continue;
    let monto, inicioPago, finPago;
    if (saving) {
      monto = cents(Number(saving[1].replaceAll(',', '')));
      // The explicitly recorded per-fortnight amount wins; never divide by days.
      inicioPago = periodo.inicio; finPago = periodo.fin;
    } else {
      monto = montoMensual;
      const months = new Set([periodo.inicio.slice(0, 7), periodo.fin.slice(0, 7)]);
      const occurrences = [...months].map(month => {
        const last = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0)).getUTCDate();
        return `${month}-${String(Math.min(Number(due[1]), last)).padStart(2, '0')}`;
      }).filter(date => date >= periodo.inicio && date <= periodo.fin);
      const date = occurrences.at(-1);
      if (!date) continue;
      inicioPago = `${date.slice(0, 7)}-01`;
      finPago = `${date.slice(0, 7)}-${String(new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5)), 0)).getUTCDate())}`;
    }
    const ultimoPago = blank(row[7]) ? null : dateText(row[7]);
    if (ultimoPago && ultimoPago > today) { issue('pago_futuro', nombre); continue; }
    if (ultimoPago && ultimoPago >= inicioPago && ultimoPago <= finPago) {
      if (estado === 'Pendiente') issue('conciliar_compromiso', nombre);
      continue;
    }
    if (estado === 'Pagado') { issue('pago_sin_periodo', nombre); continue; }
    const metodo = blank(row[5]) ? '' : label(row[5]);
    const internalReserve = saving && row[1] === 'Ahorro' && !metodo;
    if (!internalReserve && metodo !== 'Efectivo' && !debits.has(metodo)) { issue('metodo_sin_confirmar', nombre); continue; }
    // Existing sheets have no payment IDs. Do not guess from amount or prose:
    // any outgoing movement (including cash) could already be this payment.
    if (expenses.some(movement => movement.fecha >= inicioPago && movement.fecha <= finPago)) {
      issue('conciliar_compromiso', nombre); continue;
    }
    compromisos.push({ nombre, monto: monto / 100 });
  }

  const dates = rows(cutDates, ['Tarjeta', 'Inicio periodo', 'Fin periodo', 'Fecha corte', 'Fecha límite']);
  const amounts = rows(cutAmounts, ['Total corte', 'Monto pagado', 'Saldo pendiente', 'Estado', 'Fecha de pago', 'Última actualización']);
  const seenCuts = new Set(), pendingCards = new Set();
  for (let i = 0; i < Math.max(dates.length, amounts.length); i++) {
    const date = dates[i] || [], amount = amounts[i] || [];
    if (date.every(blank) && amount.every(blank)) continue;
    const nombre = label(date[0]), inicio = dateText(date[1]), fin = dateText(date[2]);
    const fechaCorte = dateText(date[3]), fechaLimite = dateText(date[4]);
    const estado = label(amount[3]);
    if (['Abierto', 'Estimado', 'Proyectado'].includes(estado)) continue;
    if (!['Cerrado', 'Pendiente', 'Parcial', 'Pagado'].includes(estado)) { issue('estado_corte', nombre); continue; }
    if (fechaCorte > today) { issue('corte_no_cerrado', nombre); continue; }
    if (inicio > fin || fin > fechaCorte || fechaLimite < fechaCorte) invalid();
    const key = `${nombre}\n${fechaCorte}`;
    if (seenCuts.has(key)) { issue('corte_duplicado', nombre); continue; }
    seenCuts.add(key);
    const total = cents(amount[0]), pagado = cents(amount[1]), pendiente = cents(amount[2]);
    if (pagado > total || total - pagado !== pendiente || (estado === 'Pagado' && pendiente !== 0)) { issue('corte_inconsistente', nombre); continue; }
    if (!pendiente) continue;
    if (!periodo || fechaLimite > periodo.fin) continue;
    if (pendingCards.has(nombre)) { issue('cortes_solapados', nombre); continue; }
    pendingCards.add(nombre);
    const actualizado = blank(amount[5]) ? null : dateText(amount[5]);
    if (!actualizado || actualizado < fechaCorte || actualizado > today) { issue('corte_sin_conciliar', nombre); continue; }
    // Date-only timestamps cannot establish ordering for payments on the same day.
    if (expenses.some(movement => movement.fecha >= actualizado)) {
      issue('conciliar_corte', nombre); continue;
    }
    cortes.push({ nombre, fechaCorte, monto: pendiente / 100 });
  }
  const commitmentsIncomplete = pendientes.some(item => !item.codigo.includes('corte'));
  const cutsIncomplete = !periodo || pendientes.some(item => item.codigo.includes('corte'));
  const compromisosApartados = commitmentsIncomplete ? null : sum(compromisos.map(item => cents(item.monto))) / 100;
  const cortesPendientes = cutsIncomplete ? null : sum(cortes.map(item => cents(item.monto))) / 100;
  return { estado: pendientes.length ? 'incompleto' : 'completo', periodo, dineroDisponible: disponible / 100,
    compromisosApartados, cortesPendientes, dineroLibre: pendientes.length ? null : sum([disponible, -cents(compromisosApartados), -cents(cortesPendientes)]) / 100,
    compromisos, cortes, pendientes };
}

export function createFreeMoneyReader({ auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] }),
  fetchImpl = fetch, timeoutMs = 8000, now = () => new Date(), anchor = '' } = {}) {
  return async () => {
    const controller = new AbortController(); let timer;
    try {
      return await Promise.race([(async () => {
        const client = await auth.getClient(), headers = await client.getRequestHeaders();
        controller.signal.throwIfAborted();
        const url = new URL(`https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values:batchGet`);
        for (const range of FREE_MONEY_RANGES) url.searchParams.append('ranges', range);
        url.searchParams.set('valueRenderOption', 'UNFORMATTED_VALUE'); url.searchParams.set('fields', 'valueRanges(values)');
        const response = await fetchImpl(url, { method: 'GET', headers, signal: controller.signal, cache: 'no-store', redirect: 'error' });
        if (response.status !== 200) invalid();
        const data = await response.json();
        if (!Array.isArray(data.valueRanges) || data.valueRanges.length !== FREE_MONEY_RANGES.length) invalid();
        const [names, balances, commitments, cutDates, cutAmounts, movements] = data.valueRanges.map(range => range.values === undefined ? [] : range.values);
        return calculateFreeMoney({ available: aggregateAvailableMoney(names, balances), commitments, cutDates, cutAmounts, movements, today: mexicoToday(now()), anchor });
      })(), new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(Error('timeout')); }, timeoutMs); })]);
    } catch { throw Error('Free money unavailable'); }
    finally { clearTimeout(timer); }
  };
}
