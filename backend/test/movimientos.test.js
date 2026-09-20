import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { PassThrough } from 'node:stream';
import { createApp } from '../src/app.js';
import { movimientoRow, TEXT_LIMITS, readMovementBody } from '../src/movimientos.js';
import { createMovementWriter } from '../src/sheets-write.js';
import { SPREADSHEET_ID, MOVIMIENTOS_RANGE } from '../src/config.js';

const valid = { fecha: '2024-02-29', hora: '23:59', tipo: 'Gasto', categoria: 'Prueba', monto: 1,
  descripcion: 'Registro controlado', metodo: 'Prueba', origen: 'API', textoOriginal: 'Prueba estructurada' };
const expected = ['2024-02-29', '23:59', 'Gasto', 'Prueba', 1, 'Registro controlado', 'Prueba', 'API', 'Prueba estructurada'];
const success = () => ({ status: 200, json: async () => ({ updates: {
  updatedRows: 1, updatedColumns: 9, updatedCells: 9, updatedRange: "'Movimientos'!A2:I2"
} }) });
const fakeAuth = { getClient: async () => ({ getRequestHeaders: async () => new Headers({ Authorization: 'Bearer synthetic-service-token' }) }) };

async function setup(t, options = {}) {
  const writes = [];
  const server = createApp({ authorizedSub: 'owner', verify: async token => {
    if (token === 'test.owner.signature') return 'owner';
    if (token === 'test.other.signature') return 'other';
    throw new Error('invalid');
  }, writeMovement: async movement => { writes.push(movement); return true; }, ...options });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const request = (body = JSON.stringify(valid), headers = {}, route = '/api/movimientos', method = 'POST') =>
    fetch(`http://127.0.0.1:${server.address().port}${route}`, { method,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test.owner.signature', ...headers },
      ...(method === 'POST' ? { body } : {}) });
  return { request, writes };
}

function invalidPayloads() {
  const cases = [null, [], {}, { ...valid, extra: 'x' }, { ...valid, spreadsheetId: 'other' },
    { ...valid, sheet: 'Other' }, { ...valid, identity: 'owner' }];
  for (const key of Object.keys(valid)) { const p = { ...valid }; delete p[key]; cases.push(p); }
  for (const fecha of ['2023-02-29', '1900-02-29', '2024-04-31', '2024-00-01', '2024-13-01', '2024-01-00',
    '0000-01-01', '2024-1-01', '24-01-01', '2024-01-01T00:00:00Z', ' 2024-01-01', '=TODAY()', 20240101]) cases.push({ ...valid, fecha });
  for (const hora of ['24:00', '12:60', '1:00', '00:0', '12:00:00', '12:00 ', '=NOW()', null]) cases.push({ ...valid, hora });
  for (const tipo of ['gasto', 'Otro', '', '=1', null]) cases.push({ ...valid, tipo });
  for (const monto of [0, -1, '1', null, true, NaN, Infinity, -Infinity]) cases.push({ ...valid, monto });
  for (const [key, limit] of Object.entries(TEXT_LIMITS)) {
    for (const value of ['', ' \t\n', null, 123, {}, 'a'.repeat(limit + 1)]) cases.push({ ...valid, [key]: value });
  }
  return cases;
}

test('movement validation rejects invalid shapes, dates, times, enums, amounts and text limits', () => {
  for (const payload of invalidPayloads()) assert.throws(() => movimientoRow(payload), /Invalid movement/);
  assert.deepEqual(movimientoRow(valid), expected);
  assert.equal(movimientoRow({ ...valid, fecha: '2000-02-29', hora: '00:00', tipo: 'Ingreso', monto: 0.01 })[4], 0.01);
  for (const [key, limit] of Object.entries(TEXT_LIMITS)) {
    assert.doesNotThrow(() => movimientoRow({ ...valid, [key]: 'x'.repeat(limit) }));
  }
  assert.equal(movimientoRow({ ...valid, descripcion: '  sin normalizar  ' })[5], '  sin normalizar  ');
});

test('authorized movement returns only registered and writes once', async t => {
  const { request, writes } = await setup(t);
  const res = await request();
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await res.json(), { registered: true });
  assert.deepEqual(writes, [valid]);
});

test('movement rejects missing, invalid and unauthorized identity before any write', async t => {
  const { request, writes } = await setup(t);
  for (const [Authorization, status] of [['', 401], ['Bearer invalid', 401], ['Bearer test.invalid.signature', 401], ['Bearer test.other.signature', 403]]) {
    const res = await request(JSON.stringify(valid), { Authorization });
    assert.equal(res.status, status);
    assert.equal(res.headers.get('cache-control'), 'no-store');
  }
  assert.equal(writes.length, 0);
  for (const [options, status] of [[{ authorizedSub: '' }, 503],
    [{ verify: () => new Promise(() => {}), verificationTimeoutMs: 10 }, 401]]) {
    const h = await setup(t, options);
    assert.equal((await h.request()).status, status);
    assert.equal(h.writes.length, 0);
  }
});

test('all invalid movement payloads and malformed JSON result in zero writes', async t => {
  const { request, writes } = await setup(t);
  const bodies = invalidPayloads().map(value => JSON.stringify(value));
  bodies.push('', '{', JSON.stringify(valid).replace('"monto":1', '"monto":NaN'),
    JSON.stringify(valid).replace('"monto":1', '"monto":Infinity'),
    JSON.stringify(valid).replace('"monto":1', '"monto":1e999'));
  for (const body of bodies) {
    const res = await request(body);
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: 'invalid_movement' });
  }
  assert.equal((await request('x'.repeat(16385))).status, 413);
  assert.equal((await request(JSON.stringify(valid), { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await request(JSON.stringify(valid), { 'Content-Encoding': 'gzip' })).status, 415);
  assert.equal(writes.length, 0);
});

test('movement CORS supports only current origins and the fixed POST route', async t => {
  const { request, writes } = await setup(t);
  for (const Origin of ['http://localhost:8000', 'https://luigytc.github.io']) {
    const res = await request(undefined, { Origin, 'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'authorization,content-type' }, '/api/movimientos', 'OPTIONS');
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('access-control-allow-origin'), Origin);
    assert.equal(res.headers.get('access-control-allow-methods'), 'POST');
    assert.equal(res.headers.get('access-control-allow-credentials'), null);
  }
  const denied = await request(undefined, { Origin: 'https://evil.example' });
  assert.equal(denied.status, 403);
  assert.equal(denied.headers.get('access-control-allow-origin'), null);
  assert.equal((await request(undefined, {}, '/api/movimientos', 'GET')).status, 405);
  assert.equal((await request(undefined, {}, '/api/movimientos?sheet=Other')).status, 404);
  assert.equal(writes.length, 0);
});

test('ADC writer appends exactly one RAW row A:I with service credentials, no overwrite', async t => {
  let calls = 0;
  const writer = createMovementWriter({ auth: fakeAuth, fetchImpl: async (url, options) => {
    calls++;
    assert.equal(url.origin, 'https://sheets.googleapis.com');
    assert.equal(decodeURIComponent(url.pathname), `/v4/spreadsheets/${SPREADSHEET_ID}/values/${MOVIMIENTOS_RANGE}:append`);
    assert.equal(url.searchParams.get('valueInputOption'), 'RAW');
    assert.equal(url.searchParams.get('insertDataOption'), 'INSERT_ROWS');
    assert.equal(url.searchParams.get('includeValuesInResponse'), 'false');
    assert.equal(options.method, 'POST');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.get('Authorization'), 'Bearer synthetic-service-token');
    assert.deepEqual(JSON.parse(options.body), { majorDimension: 'ROWS', values: [expected] });
    return success();
  } });
  const { request } = await setup(t, { writeMovement: writer });
  assert.equal((await request()).status, 200);
  assert.equal(calls, 1);
});

test('formula-like text stays unchanged as RAW strings in every free-text column', async () => {
  for (const prefix of ['=', '+', '-', '@', '\t=', '\r=', '\n=', ' =', '\uFEFF=', '＝', '＋', '－', '＠']) {
    const payload = { ...valid };
    for (const key of Object.keys(TEXT_LIMITS)) payload[key] = `${prefix}SUM(1,2)`;
    const writer = createMovementWriter({ auth: fakeAuth, fetchImpl: async (url, options) => {
      assert.equal(url.searchParams.get('valueInputOption'), 'RAW');
      const { values } = JSON.parse(options.body);
      assert.equal(values.length, 1);
      assert.deepEqual(values[0], movimientoRow(payload));
      for (const column of [0, 1, 2, 3, 5, 6, 7, 8]) assert.equal(typeof values[0][column], 'string');
      return success();
    } });
    assert.equal(await writer(payload), true);
  }
});

test('writer failures never replay an append and endpoint returns a generic error', async t => {
  for (const failure of [401, 403, 429, 500, 'network', 'bad-json', 'wrong-range', 'two-rows']) {
    let calls = 0;
    const writer = createMovementWriter({ auth: fakeAuth, fetchImpl: async () => {
      calls++;
      if (failure === 'network') throw new Error('synthetic sensitive provider detail');
      if (failure === 'bad-json') return { status: 200, json: async () => { throw new Error('private'); } };
      if (failure === 'wrong-range' || failure === 'two-rows') return { status: 200, json: async () => ({ updates: {
        updatedRows: failure === 'two-rows' ? 2 : 1, updatedColumns: 9, updatedCells: 9, updatedRange: 'Other!A2:I2'
      } }) };
      return { status: failure };
    } });
    const { request } = await setup(t, { writeMovement: writer });
    const res = await request();
    assert.equal(res.status, 503);
    assert.deepEqual(await res.json(), { error: 'movement_unavailable' });
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.equal(calls, 1);
  }
});

test('writer validates before ADC and handles missing ADC and timeout without late writes', async () => {
  let calls = 0;
  const writer = createMovementWriter({ auth: { getClient: async () => { calls++; throw new Error('private ADC error'); } } });
  await assert.rejects(writer({ ...valid, monto: NaN }), /Invalid movement/);
  assert.equal(calls, 0);
  await assert.rejects(writer(valid), /^Error: Movement unavailable$/);
  let finish;
  const delayed = createMovementWriter({ timeoutMs: 10, auth: { getClient: () => new Promise(resolve => { finish = resolve; }) },
    fetchImpl: async () => { calls++; return success(); } });
  await assert.rejects(delayed(valid), /Movement unavailable/);
  finish(await fakeAuth.getClient());
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1);
  let signal;
  const slowWrite = createMovementWriter({ timeoutMs: 10, auth: fakeAuth, fetchImpl: async (_, options) => {
    signal = options.signal;
    return new Promise(() => {});
  } });
  await assert.rejects(slowWrite(valid), /Movement unavailable/);
  assert.equal(signal.aborted, true);
});

test('body reader bounds chunked input, slow requests and invalid UTF-8', async () => {
  const big = new PassThrough();
  const pending = readMovementBody(big);
  big.write(Buffer.alloc(10000)); big.end(Buffer.alloc(10000));
  await assert.rejects(pending, error => error.status === 413);
  const slow = new PassThrough();
  await assert.rejects(readMovementBody(slow, 10), error => error.status === 408);
  slow.destroy();
  const invalid = new PassThrough();
  const invalidPending = readMovementBody(invalid);
  invalid.end(Buffer.from([0xff]));
  await assert.rejects(invalidPending, error => error.status === 400);
});
