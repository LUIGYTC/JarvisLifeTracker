import { aggregateDashboard, createDashboardReader } from './dashboard.js';

export function tarjetaSelection(params) {
  const name = params.get('tarjeta');
  if ([...params.keys()].length !== 1 || !name || !name.trim() || name.length > 100) throw new Error('Invalid selection');
  return name; // Exact match, no case folding, trimming or client-supplied ranges.
}

export function cardMovements(values = [], tarjeta) {
  if (!Array.isArray(values) || values.length > 10001 || values.some(row => !Array.isArray(row))) throw new Error('Invalid movements');
  const rows = values.filter(row => !row.every(cell => cell == null || (typeof cell === 'string' && !cell.trim())));
  // Filter the full fixed source BEFORE the dashboard's global recent limit.
  const selected = rows.length ? [rows[0], ...rows.slice(1).filter(row => row[6] === tarjeta)] : [];
  const movimientos = aggregateDashboard(selected).recent.slice(0, 10)
    .map(({ fecha, descripcion, categoria, monto, tipo }) => ({ fecha, descripcion, categoria, monto, tipo }));
  return { tarjeta, movimientos };
}

export function createCardMovementsReader(options = {}) {
  return tarjeta => createDashboardReader({ ...options, aggregate: values => cardMovements(values, tarjeta) })();
}
