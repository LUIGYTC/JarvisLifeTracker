import { aggregateDashboard, createDashboardReader, dateText } from './dashboard.js';
import { createMSIReader } from './compras-msi.js';

const invalid = () => { throw new Error('Invalid next cut data'); };
export function mexicoToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const value = type => parts.find(part => part.type === type).value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}
function monthCut(year, month, day) {
  const last = new Date(0);
  last.setUTCFullYear(year, month + 1, 0);
  last.setUTCDate(Math.min(day, last.getUTCDate()));
  return dateText(last.toISOString().slice(0, 10));
}
export function cutPeriod(day, today) {
  if (!Number.isInteger(day) || day < 1 || day > 31) invalid();
  dateText(today);
  const [year, monthNumber] = today.split('-').map(Number);
  let month = monthNumber - 1;
  if (today > monthCut(year, month, day)) month++;
  const fechaCorte = monthCut(year, month, day);
  const previous = monthCut(year, month - 1, day);
  const start = new Date(`${previous}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() + 1);
  return { fechaCorte, inicioPeriodo: dateText(start.toISOString().slice(0, 10)), finPeriodo: fechaCorte };
}
export function periodExpenses(values = [], tarjeta, period) {
  if (!Array.isArray(values) || values.length > 10001 || values.some(row => !Array.isArray(row))) invalid();
  const rows = values.filter(row => !row.every(cell => cell == null || (typeof cell === 'string' && !cell.trim())));
  const selected = rows.length ? [rows[0], ...rows.slice(1).filter(row => {
    if (row[2] !== 'Gasto' || row[6] !== tarjeta) return false;
    const fecha = dateText(row[0]);
    return fecha >= period.inicioPeriodo && fecha <= period.finPeriodo;
  })] : [];
  // Sum all qualifying rows, never the truncated recent-movements array.
  return aggregateDashboard(selected).summary.gastos;
}
function cents(value) {
  const result = Math.round(value * 100);
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || !Number.isSafeInteger(result) || Math.abs(value * 100 - result) > 1e-7) invalid();
  return result;
}
export function combineCut(period, comprasNormales, msiData, tarjeta) {
  if (msiData?.tarjeta !== tarjeta || !Array.isArray(msiData.compras)) invalid();
  let msiCents = 0;
  for (const compra of msiData.compras) {
    // parseMSI already enforces exact card and Activo. Missing dates do not match.
    if (compra.proximoCorte !== period.fechaCorte) continue;
    msiCents += cents(compra.mensualidad);
    if (!Number.isSafeInteger(msiCents)) invalid();
  }
  const total = cents(comprasNormales) + msiCents;
  if (!Number.isSafeInteger(total)) invalid();
  return { ...period, comprasNormales, msi: msiCents / 100, totalAcumulado: total / 100 };
}
export function createNextCutReader({ readMSI = createMSIReader(), now = () => new Date(),
  readExpenses = (tarjeta, period) => createDashboardReader({ aggregate: values => periodExpenses(values, tarjeta, period) })() } = {}) {
  return async ({ tarjeta, diaCorte }) => {
    const period = cutPeriod(diaCorte, mexicoToday(now()));
    const [comprasNormales, msiData] = await Promise.all([readExpenses(tarjeta, period), readMSI(tarjeta)]);
    return combineCut(period, comprasNormales, msiData, tarjeta);
  };
}
