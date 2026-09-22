import { aggregateDashboard, createDashboardReader, dateText } from './dashboard.js';
import { createTarjetasReader } from './tarjetas-credito.js';

export function currentMonthPeriod(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const part = type => parts.find(item => item.type === type).value;
  const finPeriodo = `${part('year')}-${part('month')}-${part('day')}`;
  return { inicioPeriodo: `${finPeriodo.slice(0, 7)}-01`, finPeriodo };
}

export function aggregateCardExpenses(values = [], tarjetas, period) {
  const invalid = () => { throw new Error('Invalid card expenses'); };
  dateText(period.inicioPeriodo); dateText(period.finPeriodo);
  if (period.inicioPeriodo > period.finPeriodo || !Array.isArray(tarjetas) || !Array.isArray(values) || values.length > 10001 || values.some(row => !Array.isArray(row))) invalid();
  const names = new Set(tarjetas.map(card => card.tarjeta));
  const rows = values.filter(row => !row.every(cell => cell == null || (typeof cell === 'string' && !cell.trim())));
  const selected = rows.length ? [rows[0], ...rows.slice(1).filter(row => {
    if (row[2] !== 'Gasto' || !names.has(row[6])) return false;
    const date = dateText(row[0]);
    return date >= period.inicioPeriodo && date <= period.finPeriodo;
  })] : [];
  // Reuse validation and integer-cent aggregation, never the truncated recent list.
  const { summary, byCategory } = aggregateDashboard(selected);
  return { ...period, total: summary.gastos, numeroCompras: summary.movimientos,
    categorias: byCategory.map(({ categoria, total }) => ({ categoria, total,
      porcentaje: summary.gastos ? total / summary.gastos * 100 : 0 })) };
}

export function createCardExpensesReader({ readTarjetas = createTarjetasReader(), now = () => new Date(),
  readExpenses = (cards, period) => createDashboardReader({ aggregate: values => aggregateCardExpenses(values, cards, period) })() } = {}) {
  return async () => {
    const period = currentMonthPeriod(now());
    const { tarjetas } = await readTarjetas();
    return readExpenses(tarjetas, period);
  };
}
