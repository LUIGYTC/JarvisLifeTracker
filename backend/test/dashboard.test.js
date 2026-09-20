import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { aggregateDashboard, createDashboardReader } from '../src/dashboard.js';
import { createApp } from '../src/app.js';
const header = ['Fecha', 'Hora', 'Tipo', 'Categoría', 'Monto', 'Descripción', 'Método'];
const rows = [header,
  ['2026-09-02', '10:00', 'Gasto', 'Comida', 10.10, 'A', 'Efectivo'],
  ['2026-09-01', '12:00', 'Ingreso', 'Trabajo', 100, 'B', 'Transferencia'],
  [], ['', '', '', '', '', '', ''],
  ['2026-09-02', '11:00', 'Gasto', 'Comida', 20.20, 'C', 'Tarjeta'],
  ['2026-09-01', '09:00', 'Gasto', 'Transporte', 5, 'D', 'Efectivo']];
test('dashboard calculates totals, expense groups, daily order and recent order without extra fields', () => {
  const data = aggregateDashboard(rows);
  assert.deepEqual(data.summary, { ingresos: 100, gastos: 35.3, balance: 64.7, movimientos: 4 });
  assert.deepEqual(data.byCategory, [{ categoria: 'Comida', total: 30.3 }, { categoria: 'Transporte', total: 5 }]);
  assert.deepEqual(data.byPaymentMethod, [{ metodo: 'Tarjeta', total: 20.2 }, { metodo: 'Efectivo', total: 15.1 }]);
  assert.deepEqual(data.daily, [{ fecha: '2026-09-01', ingresos: 100, gastos: 5 }, { fecha: '2026-09-02', ingresos: 0, gastos: 30.3 }]);
  assert.deepEqual(data.recent.map(item => item.descripcion), ['C', 'A', 'B', 'D']);
  assert.deepEqual(Object.keys(data.recent[0]), ['fecha', 'hora', 'tipo', 'categoria', 'monto', 'descripcion', 'metodo']);
});
test('dashboard handles empty data and Sheets date/time serials', () => {
  assert.equal(aggregateDashboard([]).summary.movimientos, 0);
  assert.equal(aggregateDashboard([[], [' ', '', null]]).summary.movimientos, 0);
  assert.equal(aggregateDashboard([header, []]).summary.balance, 0);
  const serial = (Date.UTC(2026, 8, 1) - Date.UTC(1899, 11, 30)) / 86400000;
  const data = aggregateDashboard([header, [serial, 0.5, 'Ingreso', 'Prueba', 1, 'Descripción', 'Prueba']]);
  assert.equal(data.recent[0].fecha, '2026-09-01'); assert.equal(data.recent[0].hora, '12:00');
});
test('dashboard fails closed for invalid rows rather than displaying misleading partial totals', () => {
  for (const [index, values] of [[4, ['1', NaN, Infinity, 0, -1, 1.001, 1e-10]], [2, ['Otro', 'gasto']],
    [0, ['2026-02-30', '=TODAY()']], [1, ['24:00', '=NOW()']], [3, ['=A1', '']], [5, ['=IMPORTDATA("x")']]]) {
    for (const value of values) { const row = [...rows[1]]; row[index] = value; assert.throws(() => aggregateDashboard([header, row])); }
  }
  assert.throws(() => aggregateDashboard([['wrong header']]));
});
test('dashboard limits recent records to twenty while totals include all valid rows', () => {
  const data = aggregateDashboard([header, ...Array.from({ length: 25 }, () => rows[1])]);
  assert.equal(data.recent.length, 20); assert.equal(data.summary.movimientos, 25); assert.equal(data.summary.gastos, 252.5);
});
test('reader uses ADC only for GET MovimientosDemo A:G and sanitizes failures', async () => {
  const auth = { getClient: async () => ({ getRequestHeaders: async () => ({}) }) };
  const reader = createDashboardReader({ auth, fetchImpl: async (url, options) => {
    assert.match(decodeURIComponent(url.pathname), /\/values\/'MovimientosDemo'!A:G$/);
    assert.equal(url.searchParams.get('valueRenderOption'), 'FORMULA');
    assert.equal(options.method, 'GET'); assert.equal(options.cache, 'no-store'); assert.equal(options.redirect, 'error');
    return { status: 200, json: async () => ({ values: rows }) };
  } });
  assert.equal((await reader()).summary.movimientos, 4);
  await assert.rejects(createDashboardReader({ auth, fetchImpl: async () => ({ status: 403 }) })(), /^Error: Dashboard unavailable$/);
  await assert.rejects(createDashboardReader({ timeoutMs: 10, auth: { getClient: () => new Promise(() => {}) } })(), /Dashboard unavailable/);
});
test('dashboard route enforces authorization, CORS, fixed range and sanitized errors', async t => {
  let reads = 0, fail = false;
  const server = createApp({ authorizedSub: 'owner', verify: async token => token === 'test.owner.signature' ? 'owner' : 'other',
    readDashboard: async () => { reads++; if (fail) throw new Error('private'); return aggregateDashboard(rows); } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(base + '/api/dashboard')).status, 401);
  assert.equal((await fetch(base + '/api/dashboard', { headers: { Authorization: 'Bearer test.other.signature' } })).status, 403);
  assert.equal(reads, 0);
  const options = { headers: { Authorization: 'Bearer test.owner.signature', Origin: 'https://luigytc.github.io' } };
  const response = await fetch(base + '/api/dashboard', options);
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('access-control-allow-origin'), options.headers.Origin);
  assert.deepEqual(await response.json(), aggregateDashboard(rows));
  assert.equal((await fetch(base + '/api/dashboard?range=Movimientos', options)).status, 404);
  assert.equal((await fetch(base + '/api/dashboard', { headers: { ...options.headers, Origin: 'https://evil.test' } })).status, 403);
  fail = true;
  const error = await fetch(base + '/api/dashboard', options);
  assert.equal(error.status, 503); assert.deepEqual(await error.json(), { error: 'dashboard_unavailable' });
});
