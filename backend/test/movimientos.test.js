import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { PassThrough } from 'node:stream';
import { createApp } from '../src/app.js';
import { movimientoRow, TEXT_LIMITS, readMovementBody } from '../src/movimientos.js';
import { createMovementWriter as realMovementWriter } from '../src/sheets-write.js';
import { SPREADSHEET_ID, MOVIMIENTOS_RANGE } from '../src/config.js';
import { aggregateDashboard } from '../src/dashboard.js';

const valid = { operationId: '12345678-1234-4234-8234-123456789abc', fecha: '2024-02-29', hora: '23:59', tipo: 'Gasto', categoria: 'Prueba', monto: 1,
  descripcion: 'Registro controlado', metodo: 'Prueba', origen: 'API', textoOriginal: 'Prueba estructurada' };
const expected = ['2024-02-29', '23:59', 'Gasto', 'Prueba', 1, 'Registro controlado', 'Prueba', '', 'API', 'Prueba estructurada'];
const success = () => ({ status: 200, json: async () => ({ updates: {
  updatedRows: 1, updatedColumns: 10, updatedCells: 10, updatedRange: "'Movimientos'!A2:J2"
} }) });
const fakeAuth = { getClient: async () => ({ getRequestHeaders: async () => new Headers({ Authorization: 'Bearer synthetic-service-token' }) }) };

test('legacy expense payloads keep compatibility while new types require distinct destinations in column H', () => {
  assert.deepEqual(movimientoRow(valid), expected);
  for (const tipo of ['Transferencia', 'Pago tarjeta']) {
    const value = { ...valid, tipo, metodo: 'Débito sintético', destino: 'Destino sintético' };
    assert.deepEqual(movimientoRow(value).slice(6), ['Débito sintético', 'Destino sintético', 'API', 'Prueba estructurada']);
    assert.throws(() => movimientoRow({ ...value, destino: '' }));
    assert.throws(() => movimientoRow({ ...value, destino: value.metodo }));
  }
});

function simulatedSheet({ movementFetch, failure, missing = false, race = false } = {}) {
  const ledger = [];
  const movements = [];
  let exists = !missing;
  let initialReads = 0;
  let release;
  const barrier = new Promise(resolve => { release = resolve; });
  const json = data => ({ status: 200, json: async () => data });
  const fetchImpl = async (url, options) => {
    const path = decodeURIComponent(url.pathname);
    const body = options.body ? JSON.parse(options.body) : null;
    if (failure === 'before') throw new Error('provider unavailable');
    if (path.endsWith(':batchUpdate')) {
      assert.equal(body.requests[0].addSheet.properties.title, 'Operaciones');
      assert.equal(body.requests[0].addSheet.properties.hidden, true);
      if (exists) return { status: 400 };
      exists = true;
      return json({ replies: [{}] });
    }
    if (!path.includes('/values/')) return json({ sheets: exists ? [{ properties: { title: 'Operaciones' } }] : [] });
    if (path.includes("'Operaciones'")) {
      if (options.method === 'GET') {
        const snapshot = ledger.map(row => [...row]);
        if (race && initialReads++ < 2) {
          if (initialReads === 2) release();
          await barrier;
        }
        return json({ values: snapshot });
      }
      assert.equal(url.searchParams.get('valueInputOption'), 'RAW');
      if (options.method === 'POST') {
        assert.equal(body.values.length, 1);
        assert.equal(body.values[0].length, 3);
        ledger.push([...body.values[0]]);
        if (failure === 'reservation-lost') throw new Error('response lost');
        return json({ updates: { updatedRows: 1, updatedRange: `Operaciones!A${ledger.length}:C${ledger.length}` } });
      }
      if (failure === 'finalize-before') throw new Error('state write failed');
      const row = Number(/!C(\d+)/.exec(path)[1]);
      ledger[row - 1][2] = body.values[0][0];
      if (failure === 'finalize-lost') throw new Error('response lost');
      return json({ updatedCells: 1 });
    }
    if (failure === 'movement-before') throw new Error('unavailable');
    movements.push(body.values[0]);
    if (failure === 'movement-lost') throw new Error('response lost');
    return movementFetch ? movementFetch(url, options) : success();
  };
  return { ledger, movements, fetchImpl };
}

// Existing writer assertions see the financial append while ledger operations
// are handled by the same persistent simulated Sheet used by idempotency tests.
function createMovementWriter(options) {
  const sheet = simulatedSheet({ movementFetch: options.fetchImpl });
  return realMovementWriter({ ...options, fetchImpl: sheet.fetchImpl });
}

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
  for (const operationId of ['', null, 1, 'invalid', '12345678-1234-1234-8234-123456789abc',
    '12345678-1234-4234-7234-123456789abc']) cases.push({ ...valid, operationId });
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

test('new movement types use the same endpoint and RAW append without updating balances or formulas', async t => {
  const { request, writes } = await setup(t);
  for (const tipo of ['Transferencia', 'Pago tarjeta']) {
    const movement = { ...valid, tipo, metodo: 'Cuenta sintética', destino: 'Destino sintético' };
    assert.equal((await request(JSON.stringify(movement))).status, 200);
    const sheet = simulatedSheet();
    assert.equal(await realMovementWriter({ auth: fakeAuth, fetchImpl: sheet.fetchImpl })(movement), true);
    assert.equal(sheet.movements.length, 1); assert.equal(sheet.movements[0].length, 10);
    assert.deepEqual(sheet.movements[0].slice(6), ['Cuenta sintética', 'Destino sintético', 'API', 'Prueba estructurada']);
  }
  assert.equal(writes.length, 2);
});

test('uncategorized internal movements round-trip through endpoint, writer and dashboard with no expense or income', async t => {
  const { request } = await setup(t);
  for (const tipo of ['Transferencia', 'Pago tarjeta']) {
    const movement = { ...valid, tipo, categoria: '', metodo: 'Cuenta origen', destino: 'Destino sintético' };
    assert.equal((await request(JSON.stringify(movement))).status, 200);
    const sheet = simulatedSheet();
    assert.equal(await realMovementWriter({ auth: fakeAuth, fetchImpl: sheet.fetchImpl })(movement), true);
    const result = aggregateDashboard([['Fecha', 'Hora', 'Tipo', 'Categoría', 'Monto', 'Descripción', 'Método', 'Destino'], ...sheet.movements]);
    assert.deepEqual(result.summary, { ingresos: 0, gastos: 0, balance: 0, movimientos: 1 });
    assert.equal(result.recent[0].tipo, tipo); assert.equal(result.recent[0].categoria, '');
    assert.equal(result.recent[0].destino, movement.destino);
    assert.equal(result.byCategory.length, 0);
  }
  for (const tipo of ['Gasto', 'Ingreso']) assert.throws(() => movimientoRow({ ...valid, tipo, categoria: '' }));
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

test('ADC writer appends exactly one RAW row A:J with service credentials, no overwrite', async t => {
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
        updatedRows: failure === 'two-rows' ? 2 : 1, updatedColumns: 10, updatedCells: 10, updatedRange: 'Other!A2:J2'
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

test('operation deduplication survives new writer instances and returns duplicate over HTTP', async t => {
  const sheet = simulatedSheet({ missing: true });
  const first = await setup(t, { writeMovement: realMovementWriter({ auth: fakeAuth, fetchImpl: sheet.fetchImpl }) });
  assert.deepEqual(await (await first.request()).json(), { registered: true });
  const restarted = await setup(t, { writeMovement: realMovementWriter({ auth: fakeAuth, fetchImpl: sheet.fetchImpl }) });
  const res = await restarted.request(JSON.stringify({ ...valid, operationId: valid.operationId.toUpperCase() }));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { registered: true, duplicate: true });
  assert.equal(sheet.movements.length, 1);
  assert.equal(sheet.ledger.length, 1);
  assert.equal(sheet.ledger[0][0], valid.operationId);
  assert.equal(sheet.ledger[0][2], 'registered');
  assert.equal(sheet.ledger[0].length, 3);
  assert.ok(Number.isFinite(Date.parse(sheet.ledger[0][1])));
});

test('lost final response returns duplicate on retry without another financial append', async () => {
  const sheet = simulatedSheet({ failure: 'finalize-lost' });
  await assert.rejects(realMovementWriter({ auth: fakeAuth, fetchImpl: sheet.fetchImpl })(valid), /Movement unavailable/);
  assert.equal(await realMovementWriter({ auth: fakeAuth, fetchImpl: sheet.fetchImpl })(valid), 'duplicate');
  assert.equal(sheet.movements.length, 1);
});

test('ambiguous reservation or movement remains pending across instances and cannot be replayed', async t => {
  for (const failure of ['reservation-lost', 'movement-before', 'movement-lost', 'finalize-before']) {
    const sheet = simulatedSheet({ failure });
    const writer = realMovementWriter({ auth: fakeAuth, fetchImpl: sheet.fetchImpl });
    await assert.rejects(writer(valid), /Movement unavailable/);
    const count = sheet.movements.length;
    assert.equal(count, ['movement-lost', 'finalize-before'].includes(failure) ? 1 : 0);
    const restarted = await setup(t, { writeMovement: realMovementWriter({ auth: fakeAuth, fetchImpl: sheet.fetchImpl }) });
    const res = await restarted.request();
    assert.equal(res.status, 409);
    assert.deepEqual(await res.json(), { error: 'operation_pending' });
    assert.equal(sheet.movements.length, count);
    assert.equal(sheet.ledger[0][2], 'pending');
  }
});

test('failure before reservation does not write either sheet', async () => {
  const sheet = simulatedSheet({ failure: 'before' });
  await assert.rejects(realMovementWriter({ auth: fakeAuth, fetchImpl: sheet.fetchImpl })(valid), /Movement unavailable/);
  assert.deepEqual(sheet.movements, []);
  assert.deepEqual(sheet.ledger, []);
});

test('racing independent instances elect the earliest persistent reservation', async () => {
  const sheet = simulatedSheet({ race: true });
  const writers = [realMovementWriter({ auth: fakeAuth, fetchImpl: sheet.fetchImpl }),
    realMovementWriter({ auth: fakeAuth, fetchImpl: sheet.fetchImpl })];
  const results = await Promise.allSettled(writers.map(writer => writer(valid)));
  assert.equal(results.filter(r => r.status === 'fulfilled' && r.value === true).length, 1);
  assert.ok(results.some(r => r.status === 'rejected' && r.reason.code === 'OPERATION_PENDING'));
  assert.equal(sheet.movements.length, 1);
  assert.equal(sheet.ledger.length, 2);
  assert.equal(await writers[1](valid), 'duplicate');
});

test('reusing a registered operation ID with another valid payload does not write it', async () => {
  const sheet = simulatedSheet();
  const writer = realMovementWriter({ auth: fakeAuth, fetchImpl: sheet.fetchImpl });
  await writer(valid);
  assert.equal(await writer({ ...valid, monto: 2 }), 'duplicate');
  assert.equal(sheet.movements.length, 1);
  assert.equal(sheet.movements[0][4], 1);
});

test('lost sheet creation response never causes a financial write and next request discovers the sheet', async () => {
  const sheet = simulatedSheet({ missing: true });
  let creations = 0;
  const fetchImpl = async (url, options) => {
    const response = await sheet.fetchImpl(url, options);
    if (url.pathname.endsWith(':batchUpdate')) { creations++; throw new Error('creation response lost'); }
    return response;
  };
  await assert.rejects(realMovementWriter({ auth: fakeAuth, fetchImpl })(valid), /Movement unavailable/);
  assert.equal(sheet.movements.length, 0);
  assert.equal(sheet.ledger.length, 0);
  assert.equal(await realMovementWriter({ auth: fakeAuth, fetchImpl })(valid), true);
  assert.equal(creations, 1);
  assert.equal(sheet.movements.length, 1);
});
