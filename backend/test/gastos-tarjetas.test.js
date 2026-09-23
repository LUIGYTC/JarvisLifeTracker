import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { aggregateCardExpenses, currentMonthPeriod, createCardExpensesReader } from '../src/gastos-tarjetas.js';
import { createDashboardReader } from '../src/dashboard.js';
import { createTarjetasReader } from '../src/tarjetas-credito.js';
import { createApp } from '../src/app.js';
import { SPREADSHEET_ID } from '../src/config.js';
const cards = [{ tarjeta: 'Sintética A' }, { tarjeta: 'Sintética B' }];
const header = ['Fecha', 'Hora', 'Tipo', 'Categoría', 'Monto', 'Descripción', 'Método', 'Destino'];
const period = { inicioPeriodo: '2036-02-01', finPeriodo: '2036-02-12' };
const row = (monto = 2.25, categoria = 'Categoría sintética', metodo = cards[0].tarjeta, fecha = period.inicioPeriodo, tipo = 'Gasto') => [fecha, '12:00', tipo, categoria, monto, 'Descripción privada sintética', metodo];

test('global period uses Mexico City today and month start, including UTC/year rollover and leap day', () => {
  for (const [instant, start, end] of [
    ['2036-02-13T05:59:59Z', '2036-02-01', '2036-02-12'],
    ['2036-02-13T06:00:00Z', '2036-02-01', '2036-02-13'],
    ['2036-03-01T05:00:00Z', '2036-02-01', '2036-02-29'],
    ['2036-01-01T05:00:00Z', '2035-12-01', '2035-12-31'],
    ['2036-01-01T06:00:00Z', '2036-01-01', '2036-01-01']]) {
    assert.deepEqual(currentMonthPeriod(new Date(instant)), { inicioPeriodo: start, finPeriodo: end });
  }
});
test('all exact existing card expenses aggregate by dynamic category with inclusive dates, count, percentages and descending order', () => {
  const result = aggregateCardExpenses([header, row(), row(4.5, 'Nueva categoría', cards[1].tarjeta, period.finPeriodo), row(),
    row(99, 'Excluded', 'unknown'), row(99, 'Excluded', cards[0].tarjeta + ' '), row(99, 'Excluded', cards[0].tarjeta.toLowerCase()),
    row(99, 'Excluded', cards[0].tarjeta, '2036-01-31'), row(99, 'Excluded', cards[0].tarjeta, '2036-02-13'),
    row(99, 'Excluded', cards[0].tarjeta, period.inicioPeriodo, 'Ingreso'),
    row(99, 'Excluded', cards[0].tarjeta, period.inicioPeriodo, 'gasto'), row(2.25, 'Nueva categoría')], cards, period);
  assert.deepEqual(result, { ...period, total: 11.25, numeroCompras: 4, categorias: [
    { categoria: 'Nueva categoría', total: 6.75, porcentaje: 60 }, { categoria: 'Categoría sintética', total: 4.5, porcentaje: 40 }] });
  assert.doesNotMatch(JSON.stringify(result), /Descripción|Método|Origen|Nota|Texto original|Sintética A/);
});
test('all qualifying rows count beyond recent limit; native dates and new cards work automatically', () => {
  const rows = [header, ...Array.from({ length: 31 }, () => row(0.1))];
  assert.equal(aggregateCardExpenses(rows, cards, period).total, 3.1);
  assert.equal(aggregateCardExpenses(rows, cards, period).numeroCompras, 31);
  const serial = (Date.UTC(2036, 1, 12) - Date.UTC(1899, 11, 30)) / 86400000;
  const next = { tarjeta: 'Nueva sintética' };
  assert.equal(aggregateCardExpenses([header, row(1, 'Nueva', next.tarjeta, serial)], [...cards, next], period).total, 1);
});

test('transfers and card payments are never added to card spending even when they reference the same card', () => {
  const values = [header, row(),
    [...row(90, 'No gasto', cards[0].tarjeta, period.inicioPeriodo, 'Transferencia'), 'Cuenta destino'],
    [...row(90, 'No gasto', 'Cuenta origen', period.inicioPeriodo, 'Pago tarjeta'), cards[0].tarjeta]];
  const result = aggregateCardExpenses(values, cards, period);
  assert.equal(result.total, 2.25); assert.equal(result.numeroCompras, 1);
});
test('no movements, no cards and no matches return empty safe aggregates', () => {
  for (const [rows, names] of [[[], cards], [[header], cards], [[header, row()], []]]) {
    assert.deepEqual(aggregateCardExpenses(rows, names, period), { ...period, total: 0, numeroCompras: 0, categorias: [] });
  }
});
test('malformed matching rows and unsafe monetary sums fail closed rather than reporting partial totals', () => {
  for (const value of [NaN, Infinity, -1, 0, 0.001, '2.25']) assert.throws(() => aggregateCardExpenses([header, row(value)], cards, period));
  for (const rows of [[['wrong']], [header, null], [header, row(1, 'X', cards[0].tarjeta, 'invalid')], [header, row(60000000000000), row(60000000000000)]]) assert.throws(() => aggregateCardExpenses(rows, cards, period));
});
test('reader uses only fixed real sheet ranges, ADC injected transport, GET/no-store and fresh rows on each query', async () => {
  const calls = [], rows = [header, row()];
  const options = { auth: { getClient: async () => ({ getRequestHeaders: async () => ({}) }) }, fetchImpl: async (url, init) => {
    const range = decodeURIComponent(url.pathname).split('/values/')[1]; calls.push(range);
    assert.ok(url.pathname.startsWith(`/v4/spreadsheets/${SPREADSHEET_ID}/values/`));
    assert.equal(init.method, 'GET'); assert.equal(init.cache, 'no-store');
    assert.ok(["'Movimientos'!A:H", "'TarjetasCredito'!A:K"].includes(range));
    return { status: 200, json: async () => ({ values: range === "'Movimientos'!A:H" ? rows : [
      ['Tarjeta', 'Tipo', 'Límite', 'Utilizado base', 'Utilizado actual', 'Disponible', '% Utilización', 'Día de corte', 'Fecha/hora base', 'Fecha límite de pago', 'Domiciliada a'],
      [cards[0].tarjeta, 'Crédito', 100, 7, 10, 90, 0.1, 7, '', '', '']] }) };
  } };
  const reader = createCardExpensesReader({ now: () => new Date('2036-02-12T18:00:00Z'), readTarjetas: createTarjetasReader(options),
    readExpenses: (cards, period) => createDashboardReader({ ...options, aggregate: values => aggregateCardExpenses(values, cards, period) })() });
  assert.equal((await reader()).total, 2.25); rows.push(row(1.25)); assert.equal((await reader()).total, 3.5);
  assert.equal(calls.length, 4);
});
test('API requires identity/sub authorization, rejects client ranges, keeps CORS/no-store and sanitizes errors without writes', async t => {
  let reads = 0, writes = 0, failure = false;
  const data = aggregateCardExpenses([], cards, period);
  const server = createApp({ authorizedSub: 'synthetic-owner', verify: async token => {
    if (token === 'test.invalid.signature') throw Error(); return token === 'test.owner.signature' ? 'synthetic-owner' : 'synthetic-other';
  }, readCardExpenses: async () => { reads++; if (failure) throw Error('sensitive'); return data; }, writeMovement: async () => { writes++; } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); t.after(() => { server.closeAllConnections(); server.close(); });
  const url = `http://127.0.0.1:${server.address().port}/api/gastos-tarjetas`;
  for (const [token, status] of [['', 401], ['test.invalid.signature', 401], ['test.other.signature', 403]]) {
    const res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    assert.equal(res.status, status); assert.equal(res.headers.get('cache-control'), 'no-store');
  }
  const headers = { Authorization: 'Bearer test.owner.signature', Origin: 'https://luigytc.github.io' };
  assert.equal((await fetch(url + '?range=A:Z', { headers })).status, 404);
  assert.equal((await fetch(url, { method: 'POST', headers })).status, 405);
  assert.equal((await fetch(url, { headers: { ...headers, Origin: 'https://untrusted.test' } })).status, 403);
  assert.equal(reads, 0);
  const response = await fetch(url, { headers }); assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store'); assert.equal(response.headers.get('access-control-allow-origin'), headers.Origin);
  assert.deepEqual(await response.json(), data);
  failure = true; const error = await fetch(url, { headers }); assert.equal(error.status, 503);
  assert.deepEqual(await error.json(), { error: 'card_expenses_unavailable' }); assert.equal(writes, 0);
});
