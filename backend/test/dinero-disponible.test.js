import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { aggregateAvailableMoney, createAvailableMoneyReader, DEBIT_RANGES } from '../src/dinero-disponible.js';
import { createApp } from '../src/app.js';
const parse = rows => aggregateAvailableMoney([['Cuenta'], ...rows.map(row => [row[0]])], [['Saldo disponible / valor actual'], ...rows.map(row => [row[1]])], [['Tipo'], ...rows.map(row => [row.every(value => value == null || (typeof value === 'string' && !value.trim())) ? '' : 'Débito'])]);

test('current Cuentas types include debit and remunerated accounts but never investments or names as rules', () => {
  const names = [['Cuenta'], ['Nueva A'], ['Nueva B'], ['Débito es solo un nombre']];
  const balances = [['Saldo disponible / valor actual'], [10], [20], [9999]];
  const types = [['Tipo'], ['Débito'], ['Cuenta remunerada'], ['Inversión']];
  assert.deepEqual(aggregateAvailableMoney(names, balances, types), { total: 30,
    cuentas: [{ nombre: 'Nueva A', saldo: 10 }, { nombre: 'Nueva B', saldo: 20 }],
    otrasCuentas: [{ nombre: 'Débito es solo un nombre', saldo: 9999, tipo: 'Inversión' }] });
  assert.throws(() => aggregateAvailableMoney(names, balances, [['Tipo'], ['Desconocido']]));
});

test('investment-only Cuentas remains visible without inflating liquid money or changing its evaluated value', () => {
  const result = aggregateAvailableMoney([['Cuenta'], ['Inversión sintética']],
    [['Saldo disponible / valor actual'], [432.10]], [['Tipo'], ['Inversión']]);
  assert.equal(result.total, 0); assert.deepEqual(result.cuentas, []);
  assert.deepEqual(result.otrasCuentas, [{ nombre: 'Inversión sintética', saldo: 432.1, tipo: 'Inversión' }]);
  assert.throws(() => aggregateAvailableMoney([['Cuenta'], ['Inversión sintética']],
    [['Saldo disponible / valor actual'], ['#VALUE!']], [['Tipo'], ['Inversión']]));
});

test('one account, dynamic names, zero, signed balances and precise sum across all accounts', () => {
  assert.deepEqual(parse([['Cuenta sintética', 12.34]]), { total: 12.34, cuentas: [{ nombre: 'Cuenta sintética', saldo: 12.34 }] });
  const data = parse([['Nueva cuenta', 0.1], ['Otra cuenta', 0.2], ['Saldo cero', 0], ['Ajuste', -0.05]]);
  assert.equal(data.total, 0.25);
  assert.equal(data.cuentas.length, 4);
  assert.deepEqual(data.cuentas[2], { nombre: 'Saldo cero', saldo: 0 });
  assert.equal(parse([['Duplicado', 1], ['Duplicado', 2]]).total, 3);
});

test('empty dataset, headers only and blank rows preserve alignment', () => {
  assert.deepEqual(aggregateAvailableMoney(), { total: 0, cuentas: [] });
  assert.deepEqual(parse([]), { total: 0, cuentas: [] });
  assert.equal(parse([[], [' ', null], ['Nueva', 4], []]).total, 4);
});

test('invalid rows fail closed, including missing fields, invalid money and overflow', () => {
  for (const row of [['', 1], ['Nombre'], [null, 1], [3, 1], ['x'.repeat(101), 1],
    ...['1', '', null, NaN, Infinity, 0.001, Number.MAX_SAFE_INTEGER].map(value => ['Cuenta', value])]) {
    assert.throws(() => parse([['Válida', 5], row]));
  }
  for (const names of [null, {}, [null], [['Incorrecto']], Array(10002).fill([])]) assert.throws(() => aggregateAvailableMoney(names, []));
  assert.throws(() => parse([['A', 50000000000000], ['B', 50000000000000]]));
});

test('reader uses ADC headers and only debit name/balance columns, reads fresh evaluated values', async () => {
  let calls = 0;
  const headers = { Authorization: 'Bearer synthetic-adc' };
  const reader = createAvailableMoneyReader({ auth: { getClient: async () => ({ getRequestHeaders: async () => headers }) }, fetchImpl: async (url, options) => {
    calls++;
    assert.deepEqual(url.searchParams.getAll('ranges'), DEBIT_RANGES);
    assert.deepEqual(DEBIT_RANGES, ["'Cuentas'!A:A", "'Cuentas'!E:E", "'Cuentas'!C:C"]);
    assert.equal(url.searchParams.get('fields'), 'valueRanges(values)');
    assert.equal(url.searchParams.get('valueRenderOption'), 'UNFORMATTED_VALUE');
    assert.equal(options.headers, headers);
    assert.equal(options.method, 'GET'); assert.equal(options.cache, 'no-store'); assert.equal(options.redirect, 'error');
    return { status: 200, json: async () => ({ valueRanges: [{ values: [['Cuenta'], ['Dinámica']] }, { values: [['Saldo disponible / valor actual'], [calls]] }, { values: [['Tipo'], ['Débito']] }] }) };
  } });
  assert.deepEqual(await reader(), { total: 1, cuentas: [{ nombre: 'Dinámica', saldo: 1 }] });
  assert.equal((await reader()).total, 2);
});

test('reader sanitizes provider errors, malformed responses and timeouts', async () => {
  const auth = { getClient: async () => ({ getRequestHeaders: async () => ({}) }) };
  for (const response of [{ status: 403 }, { status: 200, json: async () => ({}) }, { status: 200, json: async () => ({ valueRanges: [{}] }) }]) {
    await assert.rejects(createAvailableMoneyReader({ auth, fetchImpl: async () => response })(), /^Error: Available money unavailable$/);
  }
  await assert.rejects(createAvailableMoneyReader({ auth: { getClient: () => new Promise(() => {}) }, timeoutMs: 5 })(), /^Error: Available money unavailable$/);
  const empty = createAvailableMoneyReader({ auth, fetchImpl: async () => ({ status: 200, json: async () => ({ valueRanges: [{}, {}, {}] }) }) });
  assert.deepEqual(await empty(), { total: 0, cuentas: [] });
});

test('route authenticates Google sub, preserves CORS/no-store and never calls other finance readers', async t => {
  let reads = 0, fail = false;
  const forbidden = () => { throw Error('Unrelated reader'); };
  const server = createApp({ authorizedSub: 'owner', verify: async token => token === 'test.owner.signature' ? 'owner' : 'other',
    readDashboard: forbidden, readTarjetas: forbidden, readMSI: forbidden, readNextCut: forbidden, readCardExpenses: forbidden,
    readAvailableMoney: async () => { reads++; if (fail) throw Error('private provider data'); return parse([['Sintética', 1]]); } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const url = `http://127.0.0.1:${server.address().port}/api/dinero-disponible`;
  const headers = { Authorization: 'Bearer test.owner.signature', Origin: 'https://luigytc.github.io' };
  for (const [options, status] of [[{}, 401], [{ headers: { Authorization: 'Bearer test.other.signature' } }, 403],
    [{ headers: { ...headers, Origin: 'https://evil.test' } }, 403], [{ method: 'POST', headers }, 405]]) {
    const response = await fetch(url, options); assert.equal(response.status, status); assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  assert.equal(reads, 0);
  const response = await fetch(url, { headers });
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('access-control-allow-origin'), headers.Origin);
  assert.deepEqual(await response.json(), parse([['Sintética', 1]]));
  assert.equal((await fetch(url + '?range=Other', { headers })).status, 404);
  const preflight = await fetch(url, { method: 'OPTIONS', headers: { Origin: headers.Origin, 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'Authorization' } });
  assert.equal(preflight.status, 204);
  fail = true;
  const error = await fetch(url, { headers }); assert.equal(error.status, 503); assert.equal(error.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await error.json(), { error: 'available_money_unavailable' });
});
