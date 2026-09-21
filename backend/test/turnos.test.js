import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../src/app.js';
import { shiftRange, parseTurnos, createTurnosReader } from '../src/turnos.js';
// Synthetic fixtures, unrelated to the private spreadsheet.
const header = ['Fecha turno', 'Hora inicio', 'Hora fin', 'Tipo', 'Estado', 'Nota'];
const range = { from: '2032-03-01', to: '2032-03-31' };
const rows = [header, ['2032-03-01', '08:00', '16:00', 'Trabajo', 'Confirmado', '', 'internal', 'original'],
  ['2032-03-01', '23:00', '07:00', 'Trabajo', 'Tentativo', 'Fixture']];
test('shift range requires exactly two real ISO dates and at most 62 inclusive days', () => {
  assert.deepEqual(shiftRange(new URLSearchParams(range)), range);
  for (const query of ['', 'from=2032-03-01', 'from=2032-02-30&to=2032-03-01', 'from=2032-03-02&to=2032-03-01',
    'from=2032-01-01&to=2032-04-01', 'from=2032-3-01&to=2032-03-02', 'from=0000-01-01&to=0000-01-02',
    'from=2032-03-01&to=2032-03-31&range=A:H', 'from=2032-03-01&from=2032-03-01&to=2032-03-31']) {
    assert.throws(() => shiftRange(new URLSearchParams(query)));
  }
});
test('operational date preserves multiple blocks, overnight leap boundary and exact public fields', () => {
  const { turnos } = parseTurnos(rows, range);
  assert.equal(turnos.length, 2);
  assert.equal(turnos[0].inicioReal, '2032-03-01T08:00:00');
  assert.equal(turnos[0].finReal, '2032-03-01T16:00:00');
  assert.equal(turnos[1].fechaTurno, '2032-03-01');
  assert.equal(turnos[1].inicioReal, '2032-02-29T23:00:00');
  assert.equal(turnos[1].finReal, '2032-03-01T07:00:00');
  assert.deepEqual(Object.keys(turnos[0]), ['fechaTurno', 'horaInicio', 'horaFin', 'tipo', 'estado', 'nota', 'inicioReal', 'finReal']);
  assert.doesNotMatch(JSON.stringify(turnos), /internal|original/);
  const equal = parseTurnos([header, ['2033-01-01', '08:00', '08:00', 'Trabajo', 'Confirmado']], { from: '2033-01-01', to: '2033-01-01' });
  assert.equal(equal.turnos[0].inicioReal, '2032-12-31T08:00:00');
});
test('invalid and empty rows are skipped, date/time serials supported, bad headers fail closed', () => {
  const serial = (Date.parse('2032-03-02') - Date.UTC(1899, 11, 30)) / 86400000;
  const data = parseTurnos([...rows, [], [''], null, ['2032-02-30'],
    ['2032-03-02', '24:00', '07:00', 'Trabajo', 'Confirmado'],
    ['2032-03-02', '08:00', '16:00', '=A1', 'Confirmado'],
    [serial, 8 / 24, 16 / 24, 'Trabajo', 'Confirmado'],
    ['2032-04-01', '08:00', '16:00', 'Trabajo', 'Confirmado']], range);
  assert.equal(data.turnos.length, 3);
  assert.equal(data.turnos[2].horaInicio, '08:00');
  assert.equal(data.turnos[2].nota, '');
  assert.throws(() => parseTurnos([['bad header']], range));
  assert.deepEqual(parseTurnos([], range), { turnos: [] });
});
test('ADC reader only reads Turnos A:F and sanitizes errors and timeouts', async () => {
  const auth = { getClient: async () => ({ getRequestHeaders: async () => ({}) }) };
  const reader = createTurnosReader({ auth, fetchImpl: async (url, options) => {
    assert.match(decodeURIComponent(url.pathname), /\/values\/'Turnos'!A:F$/);
    assert.equal(url.searchParams.get('valueRenderOption'), 'FORMULA');
    assert.equal(options.method, 'GET'); assert.equal(options.cache, 'no-store');
    assert.equal(options.redirect, 'error');
    return { status: 200, json: async () => ({ values: rows }) };
  } });
  assert.equal((await reader(range)).turnos.length, 2);
  await assert.rejects(createTurnosReader({ auth, fetchImpl: async () => { throw new Error('private'); } })(range), /^Error: Turnos unavailable$/);
  await assert.rejects(createTurnosReader({ auth: { getClient: () => new Promise(() => {}) }, timeoutMs: 5 })(range), /Turnos unavailable/);
});
test('turnos API shares authorization, validates queries before reading and preserves CORS/no-store', async t => {
  let reads = 0, fail = false;
  const server = createApp({ authorizedSub: 'owner', verify: async token => {
    if (token === 'invalid.test.signature') throw new Error('invalid');
    return token === 'test.owner.signature' ? 'owner' : 'other';
  }, readTurnos: async input => { reads++; assert.deepEqual(input, range); if (fail) throw new Error('private'); return parseTurnos(rows, input); } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}/api/turnos`;
  const url = base + '?' + new URLSearchParams(range);
  assert.equal((await fetch(url)).status, 401);
  assert.equal((await fetch(url, { headers: { Authorization: 'Bearer invalid.test.signature' } })).status, 401);
  assert.equal((await fetch(url, { headers: { Authorization: 'Bearer test.other.signature' } })).status, 403);
  const headers = { Authorization: 'Bearer test.owner.signature', Origin: 'https://luigytc.github.io' };
  assert.equal((await fetch(base, { headers })).status, 400);
  assert.equal((await fetch(url + '&sheet=Other', { headers })).status, 400);
  assert.equal(reads, 0);
  const response = await fetch(url, { headers });
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('access-control-allow-origin'), headers.Origin);
  assert.deepEqual(await response.json(), parseTurnos(rows, range));
  assert.equal((await fetch(url, { headers: { ...headers, Origin: 'https://invalid.test' } })).status, 403);
  assert.equal((await fetch(url, { method: 'OPTIONS', headers: { Origin: headers.Origin, 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'Authorization' } })).status, 204);
  fail = true;
  const error = await fetch(url, { headers });
  assert.equal(error.status, 503); assert.deepEqual(await error.json(), { error: 'turnos_unavailable' });
});
