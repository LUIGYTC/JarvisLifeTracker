import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { parseTarjetas, createTarjetasReader } from '../src/tarjetas-credito.js';
import { createApp } from '../src/app.js';
import { SPREADSHEET_ID } from '../src/config.js';

// Synthetic fixtures only; never read the real spreadsheet during tests.
const header = ['Tarjeta', 'Tipo', 'Límite', 'Utilizado', 'Disponible', '% Utilización',
  'Día de corte', 'Última actualización', 'Fecha límite de pago', 'Domiciliada a'];
const row = ['Prueba A', 'Crédito', 1000, 250.1, 749.9, 0.2501, 15, '2032-01-01', '2032-01-25', 'Cuenta de prueba'];
const expected = { tarjeta: 'Prueba A', tipo: 'Crédito', limite: 1000, utilizado: 250.1, disponible: 749.9,
  porcentajeUtilizacion: 25.01, diaCorte: 15, ultimaActualizacion: '2032-01-01', fechaLimitePago: '2032-01-25', domiciliadaA: 'Cuenta de prueba' };

test('credit cards expose exactly the ten named fields and omit unrelated sensitive columns', () => {
  const data = parseTarjetas([[...header, 'Numero', 'Credencial'], [...row, 'synthetic-secret-number', 'synthetic-secret-token']]);
  assert.deepEqual(data, { tarjetas: [expected] });
  assert.doesNotMatch(JSON.stringify(data), /Numero|Credencial|synthetic-secret/);
});

test('credit cards normalize numeric cells, strict monetary strings, ratios and explicit percentages', () => {
  const data = parseTarjetas([header, ['  Prueba A  ', 'Crédito', '$1,000.00', '250.10', 'MXN 749.90', '25.01%', '15', '1/1/2032', '25/1/2032', 'Cuenta de prueba']]);
  assert.deepEqual(data, { tarjetas: [expected] });
  assert.equal(parseTarjetas([header, [...row.slice(0, 5), 1, ...row.slice(6)]]).tarjetas[0].porcentajeUtilizacion, 100);
  assert.equal(parseTarjetas([header, [...row.slice(0, 5), '0.2501', ...row.slice(6)]]).tarjetas[0].porcentajeUtilizacion, 25.01);
  const overLimit = [...row]; overLimit[3] = 1200; overLimit[4] = -200; overLimit[5] = 1.2;
  assert.equal(parseTarjetas([header, overLimit]).tarjetas[0].disponible, -200);
  assert.equal(parseTarjetas([header, overLimit]).tarjetas[0].porcentajeUtilizacion, 120);
});

test('credit cards support native Sheet dates and absent optional fields without inventing payment dates', () => {
  const serial = (Date.UTC(2032, 0, 1) - Date.UTC(1899, 11, 30)) / 86400000;
  const native = [...row]; native[7] = serial + 0.5; native[8] = serial + 24;
  assert.deepEqual(parseTarjetas([header, native]), { tarjetas: [expected] });
  const partial = [...row.slice(0, 6)];
  assert.deepEqual(parseTarjetas([header, partial]).tarjetas[0], { ...expected, diaCorte: null, ultimaActualizacion: null, fechaLimitePago: null, domiciliadaA: null });
  assert.deepEqual(parseTarjetas([]), { tarjetas: [] });
  assert.deepEqual(parseTarjetas([header, [], ['', ' ']]), { tarjetas: [] });
  const zero = [...row]; zero[2] = zero[3] = zero[4] = zero[5] = 0;
  assert.equal(parseTarjetas([header, zero]).tarjetas[0].porcentajeUtilizacion, 0);
});

test('invalid credit card rows are skipped while valid neighbors survive; malformed tables fail closed', () => {
  for (const [index, values] of [[0, ['', '=secret', 3]], [1, [null]],
    [2, [-1, NaN, Infinity, true, null, '', '1,23', '1.000,00', '1e3', 1.001, Number.MAX_SAFE_INTEGER]],
    [3, [-1, 0.001]], [4, ['=SUM(A1)', Infinity]], [5, [-0.1, 'bad%', Infinity, null]],
    [6, [0, 32, 2.5]], [7, ['2032-02-30', Infinity]], [8, ['31/02/2032', '0000-01-01']], [9, ['=A1']]]) {
    for (const value of values) {
      const invalid = [...row]; invalid[index] = value;
      assert.deepEqual(parseTarjetas([header, invalid, row, null, {}]), { tarjetas: [expected] });
    }
  }
  assert.throws(() => parseTarjetas([['Bad header'], row]));
  assert.throws(() => parseTarjetas({ values: [] }));
  assert.throws(() => parseTarjetas(Array(10002).fill(row)));
});

test('ADC credit reader uses the configured spreadsheet and exclusively GET TarjetasCredito A:J', async () => {
  let calls = 0;
  const auth = { getClient: async () => ({ getRequestHeaders: async () => ({ Authorization: 'Bearer synthetic-adc' }) }) };
  const reader = createTarjetasReader({ auth, fetchImpl: async (url, options) => {
    calls++;
    assert.equal(url.origin, 'https://sheets.googleapis.com');
    assert.equal(decodeURIComponent(url.pathname), `/v4/spreadsheets/${SPREADSHEET_ID}/values/'TarjetasCredito'!A:J`);
    assert.equal(url.searchParams.get('valueRenderOption'), 'UNFORMATTED_VALUE');
    assert.equal(url.searchParams.get('dateTimeRenderOption'), 'SERIAL_NUMBER');
    assert.equal(url.searchParams.get('fields'), 'values');
    assert.equal(options.method, 'GET'); assert.equal(options.cache, 'no-store'); assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, 'Bearer synthetic-adc');
    return { status: 200, json: async () => ({ values: [header, row] }) };
  } });
  assert.deepEqual(await reader('Untrusted!A:Z'), { tarjetas: [expected] });
  assert.equal(calls, 1);
});

test('credit reader sanitizes provider errors, invalid headers and timeouts without retries', async () => {
  const auth = { getClient: async () => ({ getRequestHeaders: async () => ({}) }) };
  for (const fetchImpl of [async () => { throw new Error('private bank details'); },
    async () => ({ status: 403 }), async () => ({ status: 200, json: async () => ({ values: [['private header']] }) })]) {
    await assert.rejects(createTarjetasReader({ auth, fetchImpl })(), /^Error: Credit cards unavailable$/);
  }
  let signal, calls = 0;
  await assert.rejects(createTarjetasReader({ auth, timeoutMs: 10, fetchImpl: async (_, options) => {
    calls++; signal = options.signal; return new Promise(() => {});
  } })(), /^Error: Credit cards unavailable$/);
  assert.equal(signal.aborted, true); assert.equal(calls, 1);
  await assert.rejects(createTarjetasReader({ timeoutMs: 10, auth: { getClient: () => new Promise(() => {}) } })(), /^Error: Credit cards unavailable$/);
});

test('credit endpoint enforces identity, sub, CORS, fixed route, no-store and generic errors', async t => {
  let reads = 0, fail = false;
  const server = createApp({ authorizedSub: 'owner', verify: async token => {
    if (token === 'test.invalid.signature') throw new Error('invalid');
    return token === 'test.owner.signature' ? 'owner' : 'other';
  }, readTarjetas: async () => { reads++; if (fail) throw new Error('sensitive data'); return { tarjetas: [expected] }; } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}/api/tarjetas-credito`;
  for (const [token, status] of [['', 401], ['test.invalid.signature', 401], ['test.other.signature', 403]]) {
    const response = await fetch(base, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    assert.equal(response.status, status); assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  assert.equal(reads, 0);
  const headers = { Authorization: 'Bearer test.owner.signature', Origin: 'https://luigytc.github.io' };
  assert.equal((await fetch(base + '?range=Other!A:Z', { headers })).status, 404);
  assert.equal((await fetch(base, { method: 'POST', headers })).status, 405);
  assert.equal((await fetch(base, { headers: { ...headers, Origin: 'https://evil.test' } })).status, 403);
  const preflight = await fetch(base, { method: 'OPTIONS', headers: { Origin: headers.Origin,
    'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'Authorization' } });
  assert.equal(preflight.status, 204); assert.equal(reads, 0);
  const response = await fetch(base, { headers });
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('access-control-allow-origin'), headers.Origin);
  assert.deepEqual(await response.json(), { tarjetas: [expected] });
  fail = true;
  const error = await fetch(base, { headers });
  assert.equal(error.status, 503); assert.deepEqual(await error.json(), { error: 'tarjetas_unavailable' });
});
