import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { parseMSI, createMSIReader } from '../src/compras-msi.js';
import { createApp } from '../src/app.js';
import { SPREADSHEET_ID } from '../src/config.js';
const header = ['Compra', 'Tarjeta', 'Mensualidad', 'Mes actual', 'Meses totales', 'Próximo corte', 'Estado', 'Nota'];
// Entirely synthetic fixtures, unrelated to the user's purchases.
const row = ['Compra sintética Alfa', 'Tarjeta sintética A', 20.1, 2, 8, '2034-02-15', 'Activo', 'private-note'];
const item = { compra: row[0], mensualidad: 20.1, mesActual: 2, mesesTotales: 8, proximoCorte: '2034-02-15' };

test('MSI filters exact card and Activo, sums multiple installments safely and never exposes Nota', () => {
  const second = [...row]; second[0] = 'Compra sintética Beta'; second[2] = 30.2;
  const excluded = [['Tarjeta sintética B', 'Activo'], ['tarjeta sintética a', 'Activo'], ['Tarjeta sintética A ', 'Activo'],
    [row[1], 'activo'], [row[1], 'Activo '], [row[1], 'Finalizado']].map(([card, state]) => { const r = [...row]; r[1] = card; r[6] = state; return r; });
  const data = parseMSI([header, row, second, ...excluded], row[1]);
  assert.deepEqual(data, { tarjeta: row[1], compras: [item, { ...item, compra: second[0], mensualidad: 30.2 }], totalMensualMSI: 50.3 });
  assert.doesNotMatch(JSON.stringify(data), /Nota|private-note|estado|tarjeta sintética a/);
  assert.deepEqual(Object.keys(data.compras[0]), ['compra', 'mensualidad', 'mesActual', 'mesesTotales', 'proximoCorte']);
});

test('MSI empty data or no active matching purchases returns zero without inventing purchases', () => {
  for (const rows of [[], [header], [header, [], ['', ' ']], [header, row]]) {
    assert.deepEqual(parseMSI(rows, 'Sin compras'), { tarjeta: 'Sin compras', compras: [], totalMensualMSI: 0 });
  }
});

test('MSI normalizes numeric strings and native or local dates without advancing installments', () => {
  const serial = (Date.UTC(2034, 1, 15) - Date.UTC(1899, 11, 30)) / 86400000;
  for (const date of [serial, '15/2/2034', '2034-02-15', null]) {
    const r = [...row]; r[2] = '20.10'; r[3] = '2'; r[4] = '8'; r[5] = date;
    const original = JSON.stringify(r);
    assert.deepEqual(parseMSI([header, r], row[1]).compras, [{ ...item, proximoCorte: date === null ? null : item.proximoCorte }]);
    assert.equal(JSON.stringify(r), original);
  }
});

test('invalid active MSI rows fail closed instead of understating the total; irrelevant rows are ignored', () => {
  for (const [index, values] of [[0, ['', '=A1', 8]], [2, [0, -1, 0.001, NaN, Infinity, true, '', '20x', Number.MAX_SAFE_INTEGER]],
    [3, [0, 9, 2.5, 'two']], [4, [0, 1, Infinity]], [5, ['2034-02-30', '=TODAY()', 1.5]]]) {
    for (const value of values) { const bad = [...row]; bad[index] = value; assert.throws(() => parseMSI([header, row, bad], row[1])); }
  }
  const unrelated = [...row]; unrelated[1] = 'Other'; unrelated[2] = 'bad';
  assert.equal(parseMSI([header, unrelated, row], row[1]).totalMensualMSI, 20.1);
  const huge = [...row]; huge[2] = 60000000000000;
  assert.throws(() => parseMSI([header, huge, huge], row[1]));
  assert.throws(() => parseMSI([['Wrong header'], row], row[1]));
  assert.throws(() => parseMSI([header, null], row[1]));
  assert.throws(() => parseMSI(Array(10002).fill(row), row[1]));
});

test('MSI ADC reader only GETs ComprasMSI A:H in the configured spreadsheet without writes', async () => {
  let calls = 0;
  const reader = createMSIReader({ auth: { getClient: async () => ({ getRequestHeaders: async () => ({ Authorization: 'synthetic-adc' }) }) },
    fetchImpl: async (url, options) => {
      calls++;
      assert.equal(url.origin, 'https://sheets.googleapis.com');
      assert.equal(decodeURIComponent(url.pathname), `/v4/spreadsheets/${SPREADSHEET_ID}/values/'ComprasMSI'!A:H`);
      assert.equal(url.searchParams.get('valueRenderOption'), 'UNFORMATTED_VALUE');
      assert.equal(url.searchParams.get('dateTimeRenderOption'), 'SERIAL_NUMBER');
      assert.equal(options.method, 'GET'); assert.equal(options.cache, 'no-store'); assert.equal(options.redirect, 'error');
      assert.equal(options.headers.Authorization, 'synthetic-adc');
      return { status: 200, json: async () => ({ values: [header, row] }) };
    } });
  assert.equal((await reader(row[1])).totalMensualMSI, 20.1); assert.equal(calls, 1);
});

test('MSI reader sanitizes errors and aborts timeouts', async () => {
  const auth = { getClient: async () => ({ getRequestHeaders: async () => ({}) }) };
  for (const fetchImpl of [async () => { throw Error('private-note'); }, async () => ({ status: 403 }),
    async () => ({ status: 200, json: async () => ({ values: [['bad']] }) })]) {
    await assert.rejects(createMSIReader({ auth, fetchImpl })(row[1]), /^Error: MSI unavailable$/);
  }
  let signal;
  await assert.rejects(createMSIReader({ auth, timeoutMs: 10, fetchImpl: async (_, options) => { signal = options.signal; return new Promise(() => {}); } })(row[1]), /MSI unavailable/);
  assert.equal(signal.aborted, true);
});

test('MSI endpoint enforces identity, card selection, CORS and no-store without registering expenses', async t => {
  let cards = 0, reads = 0, writes = 0, fail = false;
  const server = createApp({ authorizedSub: 'owner', verify: async token => {
    if (token === 'test.invalid.signature') throw Error('invalid');
    return token === 'test.owner.signature' ? 'owner' : 'other';
  }, readTarjetas: async () => { cards++; return { tarjetas: [{ tarjeta: row[1] }] }; },
  readMSI: async name => { reads++; if (fail) throw Error('private-note'); return parseMSI([header, row], name); },
  writeMovement: async () => { writes++; return true; } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}/api/tarjetas-credito/msi`;
  const url = `${base}?${new URLSearchParams({ tarjeta: row[1] })}`;
  for (const [token, status] of [['', 401], ['test.invalid.signature', 401], ['test.other.signature', 403]]) {
    const res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    assert.equal(res.status, status); assert.equal(res.headers.get('cache-control'), 'no-store');
  }
  assert.equal(cards, 0); assert.equal(reads, 0);
  const headers = { Authorization: 'Bearer test.owner.signature', Origin: 'https://luigytc.github.io' };
  assert.equal((await fetch(url, { headers: { ...headers, Origin: 'https://evil.test' } })).status, 403);
  assert.equal((await fetch(url, { headers, method: 'POST' })).status, 405);
  assert.equal((await fetch(url, { method: 'OPTIONS', headers: { Origin: headers.Origin, 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'Authorization' } })).status, 204);
  for (const query of ['', '?tarjeta=', '?tarjeta=A&range=A:H', '?tarjeta=A&tarjeta=B']) assert.equal((await fetch(base + query, { headers })).status, 400);
  assert.equal(cards, 0);
  assert.equal((await fetch(base + '?tarjeta=Unknown', { headers })).status, 404); assert.equal(reads, 0);
  const res = await fetch(url, { headers });
  assert.equal(res.status, 200); assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('access-control-allow-origin'), headers.Origin);
  assert.deepEqual(await res.json(), parseMSI([header, row], row[1]));
  fail = true; const error = await fetch(url, { headers });
  assert.equal(error.status, 503); assert.deepEqual(await error.json(), { error: 'msi_unavailable' });
  assert.equal(writes, 0);
});
