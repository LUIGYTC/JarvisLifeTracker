import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../src/app.js';
import { commitmentOperationId, nextCommitmentDate, planCommitment, createCommitmentStore, createCommitmentProcessor } from '../src/compromisos.js';
import { createMovementWriter } from '../src/sheets-write.js';

const header = ['Compromiso', 'Tipo', 'Monto', 'Frecuencia', 'Próxima fecha de pago', 'Método', 'Estado', 'Último pago'];
const row = () => ['Servicio sintético', 'Fijo', 12.34, 'Mensual', '2032-09-18', 'Cuenta sintética', 'Activo', ''];
const now = () => new Date('2032-09-23T18:00:00Z');
const auth = { getClient: async () => ({ getRequestHeaders: async () => new Headers({ Authorization: 'Bearer synthetic' }) }) };
const serial = value => (Date.parse(`${value}T00:00:00Z`) - Date.UTC(1899, 11, 30)) / 86400000;
const json = data => ({ status: 200, json: async () => structuredClone(data) });

// Persistent Sheets simulation shared by the real store and existing movement
// writer, including restarts and failures between their separate writes.
function sheet(rows = [row()]) {
  const state = { rows: [header, ...rows], movements: [], ledger: [], calls: [], fail: '', formula: false };
  state.fetchImpl = async (url, options) => {
    const path = decodeURIComponent(url.pathname);
    const body = options.body ? JSON.parse(options.body) : null;
    state.calls.push({ path, method: options.method, body });
    assert.equal(options.cache, 'no-store'); assert.equal(options.redirect, 'error');
    assert.equal(options.headers.get('Authorization'), 'Bearer synthetic');
    if (path.endsWith('/values:batchUpdate')) {
      if (state.fail === 'dates-before') throw new Error('private failure');
      assert.equal(body.valueInputOption, 'RAW'); assert.equal(body.data.length, 2);
      for (const item of body.data) {
        const match = /^'Compromisos'!([EH])(\d+)$/.exec(item.range);
        assert.ok(match);
        state.rows[Number(match[2]) - 1][match[1] === 'E' ? 4 : 7] = item.values[0][0];
      }
      if (state.fail === 'dates-lost') throw new Error('private failure');
      return json({ totalUpdatedCells: 2 });
    }
    if (path.includes("'Compromisos'!")) {
      assert.equal(options.method, 'GET');
      assert.equal(url.searchParams.get('dateTimeRenderOption'), 'SERIAL_NUMBER');
      if (path.endsWith('!A:H')) return json({ values: state.rows });
      assert.equal(url.searchParams.get('valueRenderOption'), 'FORMULA');
      const match = /!E(\d+):H\1$/.exec(path); assert.ok(match);
      const values = state.rows[Number(match[1]) - 1].slice(4, 8);
      if (state.formula) values[0] = '=TODAY()';
      return json({ values: [values] });
    }
    if (!path.includes('/values/')) return json({ sheets: [{ properties: { title: 'Operaciones' } }] });
    if (path.includes("'Operaciones'")) {
      if (options.method === 'GET') return json({ values: state.ledger });
      assert.equal(url.searchParams.get('valueInputOption'), 'RAW');
      if (options.method === 'POST') {
        state.ledger.push(body.values[0]);
        return json({ updates: { updatedRows: 1, updatedRange: `Operaciones!A${state.ledger.length}:C${state.ledger.length}` } });
      }
      const index = Number(/!C(\d+)/.exec(path)[1]) - 1;
      state.ledger[index][2] = body.values[0][0];
      return json({ updatedCells: 1 });
    }
    assert.ok(path.endsWith("'Movimientos'!A:J:append"));
    assert.equal(url.searchParams.get('valueInputOption'), 'RAW');
    state.movements.push(body.values[0]);
    if (state.fail === 'movement-lost') throw new Error('private failure');
    return json({ updates: { updatedRows: 1, updatedColumns: 10, updatedCells: 10, updatedRange: `Movimientos!A${state.movements.length + 1}:J${state.movements.length + 1}` } });
  };
  state.processor = options => createCommitmentProcessor({
    store: createCommitmentStore({ auth, fetchImpl: state.fetchImpl }),
    writeMovement: createMovementWriter({ auth, fetchImpl: state.fetchImpl }), now, ...options
  });
  return state;
}

test('overdue monthly commitment appends the current ten-column movement and advances only its dates', async () => {
  const s = sheet();
  const result = await s.processor()();
  assert.deepEqual(result, { fecha: '2032-09-23', limiteAlcanzado: false, resultados: [
    { compromiso: row()[0], fechaProgramada: '2032-09-18', proximaFecha: '2032-10-18', estado: 'procesado' }
  ] });
  assert.deepEqual(s.movements[0].slice(0, 9), ['2032-09-18', '00:00', 'Gasto', 'Servicios', 12.34, row()[0], row()[5], '', 'Jarvis']);
  assert.match(s.movements[0][9], /Generado automáticamente desde Compromisos.*2032-09-18/);
  assert.equal(s.rows[1][4], serial('2032-10-18')); assert.equal(s.rows[1][7], serial('2032-09-18'));
  for (const index of [0, 1, 2, 3, 5, 6]) assert.equal(s.rows[1][index], row()[index]);
  assert.ok(s.calls.every(call => !/Cuentas|TarjetasCredito|CortesTarjeta|ComprasMSI/.test(call.path)));
});

for (const method of ['BBVA Crédito', 'BBVA Débito']) {
  test(`movement preserves ${method} for existing Sheet formulas without balance writes`, async () => {
    const input = row(); input[5] = method;
    const s = sheet([input]); await s.processor()();
    assert.equal(s.movements[0][6], method); assert.equal(s.movements[0][2], 'Gasto');
    assert.ok(s.calls.filter(call => call.method !== 'GET').every(call => /Operaciones|Movimientos|values:batchUpdate/.test(call.path)));
  });
}

for (const [name, index, value, reason] of [
  ['future', 4, '2032-10-01', 'futuro'], ['inactive', 6, 'Inactivo', 'inactivo'],
  ['missing amount', 2, '', 'monto_faltante'], ['invalid amount', 2, '12', 'monto_invalido'],
  ['zero amount', 2, 0, 'monto_invalido'], ['negative amount', 2, -1, 'monto_invalido'],
  ['missing date', 4, '', 'fecha_faltante'], ['unconfirmed date', 4, 'Por confirmar', 'fecha_no_confirmada'],
  ['missing method', 5, '', 'metodo_faltante'], ['operating rule', 1, 'Regla operativa', 'regla_operativa'],
  ['card payments', 0, 'Pago de tarjetas', 'regla_operativa'],
  ['unsupported recurrence', 3, 'A convenir', 'frecuencia_no_soportada'],
  ['already paid stale date', 7, '2032-09-18', 'ultimo_pago_inconsistente']
]) {
  test(`${name} is reported without any write`, async () => {
    const input = row(); input[index] = value;
    const s = sheet([input]); const result = await s.processor()();
    assert.equal(result.resultados[0].motivo, reason);
    assert.ok(s.calls.every(call => call.method === 'GET'));
  });
}

test('today is Mexico City civil date and includes commitments due today', async () => {
  const s = sheet(); s.rows[1][4] = '2032-09-23';
  const result = await s.processor({ now: () => new Date('2032-09-24T01:00:00Z') })();
  assert.equal(result.fecha, '2032-09-23'); assert.equal(s.movements.length, 1);
});

test('repeated execution and new processor instances do not repeat registered movements', async () => {
  const s = sheet(), run = s.processor();
  await run(); await run(); await s.processor()();
  assert.equal(s.movements.length, 1); assert.equal(s.ledger.length, 1);
  // Restoring a stale schedule still cannot reappend a registered occurrence.
  s.rows[1] = row(); const result = await s.processor()();
  assert.equal(result.resultados[0].estado, 'recuperado'); assert.equal(s.movements.length, 1);
});

test('registered movement with failed date update is repaired after restart without a second append', async () => {
  const s = sheet(); s.fail = 'dates-before';
  const first = await s.processor()();
  assert.equal(first.resultados[0].motivo, 'movimiento_registrado_fechas_pendientes');
  assert.equal(s.rows[1][4], row()[4]); assert.equal(s.movements.length, 1);
  s.fail = ''; const second = await s.processor()();
  assert.equal(second.resultados[0].estado, 'recuperado');
  assert.equal(s.movements.length, 1); assert.equal(s.rows[1][4], serial('2032-10-18'));
});

test('lost date update response cannot duplicate a movement on retry', async () => {
  const s = sheet(); s.fail = 'dates-lost'; await s.processor()();
  s.fail = ''; await s.processor()(); assert.equal(s.movements.length, 1);
});

test('ambiguous movement append stays pending for manual review and does not advance dates', async () => {
  const s = sheet(); s.fail = 'movement-lost'; await s.processor()();
  s.fail = ''; const retry = await s.processor()();
  assert.equal(retry.resultados[0].motivo, 'operacion_pendiente_revision');
  assert.equal(s.movements.length, 1); assert.equal(s.rows[1][4], row()[4]);
});

test('monthly catch-up retains the original day through February and advances all due occurrences', async () => {
  const input = row(); input[4] = '2031-01-31';
  const s = sheet([input]); await s.processor({ now: () => new Date('2031-03-31T18:00:00Z') })();
  assert.deepEqual(s.movements.map(item => item[0]), ['2031-01-31', '2031-02-28', '2031-03-31']);
  assert.equal(s.rows[1][4], serial('2031-04-30'));
});

test('calendar handles leap months, year boundaries and fixed-day frequencies without guessing unsupported rules', () => {
  assert.equal(nextCommitmentDate('2032-01-31', 'Mensual'), '2032-02-29');
  assert.equal(nextCommitmentDate('2032-02-29', 'Mensual', '2032-01-31'), '2032-03-31');
  assert.equal(nextCommitmentDate('2032-12-18', 'Mensual'), '2033-01-18');
  assert.equal(nextCommitmentDate('2032-04-15', 'Mensual', '2032-03-31'), '2032-05-15');
  assert.equal(nextCommitmentDate('2032-12-31', 'Diario'), '2033-01-01');
  assert.equal(nextCommitmentDate('2032-12-31', 'Semanal'), '2033-01-07');
  assert.equal(nextCommitmentDate('2032-12-31', 'Catorcenal'), '2033-01-14');
  assert.throws(() => nextCommitmentDate('2032-12-31', 'constructor'));
});

test('serial and explicit local dates parse, invalid dates and nonnumeric amounts fail closed', () => {
  for (const date of [serial('2032-09-18'), '18/9/2032']) {
    const input = row(); input[4] = date;
    assert.equal(planCommitment(input, '2032-09-23').scheduledDate, '2032-09-18');
  }
  for (const value of [NaN, Infinity, -Infinity, true, {}, 1.001]) {
    const input = row(); input[2] = value;
    assert.equal(planCommitment(input, '2032-09-23').estado, 'no_procesable');
  }
  const input = row(); input[4] = '2032-02-30';
  assert.equal(planCommitment(input, '2032-09-23').motivo, 'fecha_no_confirmada');
});

test('batch cap leaves explicit pending work and a subsequent invocation resumes', async () => {
  const input = row(); input[4] = '2032-07-18';
  const s = sheet([input]); const run = s.processor({ maxOccurrences: 2 });
  assert.equal((await run()).limiteAlcanzado, true); assert.equal(s.movements.length, 2);
  assert.equal((await run()).limiteAlcanzado, false); assert.equal(s.movements.length, 3);
});

test('empty rows and dataset are safe, ambiguous names cannot create duplicate obligations', async () => {
  const s = sheet([[], ['', '', '', '', '', '', '', '']]);
  assert.deepEqual((await s.processor()()).resultados, []);
  s.rows = []; assert.deepEqual((await s.processor()()).resultados, []);
  const duplicate = row(); duplicate[0] = ` ${row()[0].toUpperCase()} `;
  s.rows = [header, row(), duplicate];
  assert.ok((await s.processor()()).resultados.every(item => item.motivo === 'nombre_duplicado'));
  assert.equal(s.movements.length, 0);
});

test('deterministic operation identity normalizes names and distinguishes scheduled occurrences', () => {
  const id = commitmentOperationId(' Servicio  sintético ', '2032-09-18');
  assert.equal(id, commitmentOperationId('SERVICIO SINTÉTICO', '2032-09-18'));
  assert.notEqual(id, commitmentOperationId('Servicio sintético', '2032-10-18'));
  assert.notEqual(id, commitmentOperationId('Otro', '2032-09-18'));
});

test('date formulas are never replaced and prevent the movement before reservation', async () => {
  const s = sheet(); s.formula = true;
  assert.equal((await s.processor()()).resultados[0].motivo, 'fecha_con_formula');
  assert.equal(s.movements.length, 0); assert.equal(s.ledger.length, 0);
});

test('row reorder is located afresh and edited commitments stop before writing', async () => {
  const s = sheet(), store = createCommitmentStore({ auth, fetchImpl: s.fetchImpl });
  const original = row(); s.rows.splice(1, 0, []);
  await store.prepare(original); await store.advance(original, '2032-09-18', '2032-10-18');
  assert.deepEqual(s.rows[1], []); assert.equal(s.rows[2][4], serial('2032-10-18'));
  s.rows[2] = row(); s.rows[2][2] = 99;
  await assert.rejects(store.prepare(original), error => error.code === 'compromiso_cambiado');
});

test('concurrent invocation in one app fails busy and releases its guard after failure', async () => {
  let rejectRead;
  const run = createCommitmentProcessor({ store: { read: () => new Promise((_, reject) => { rejectRead = reject; }) }, now });
  const first = run(); await assert.rejects(run(), error => error.code === 'PROCESSOR_BUSY');
  rejectRead(new Error('read failed')); await assert.rejects(first);
  const again = run(); rejectRead(new Error('read failed')); await assert.rejects(again, /read failed/);
});

test('provider failures, malformed headers and ADC timeout fail closed without late writes', async () => {
  const s = sheet(); s.rows[0] = ['Old schema'];
  await assert.rejects(s.processor()()); assert.equal(s.movements.length, 0);
  const broken = createCommitmentStore({ auth, fetchImpl: async () => { throw new Error('private detail'); } });
  await assert.rejects(broken.read(), /^Error: Commitments unavailable$/);
  let finish, calls = 0;
  const slow = createCommitmentStore({ timeoutMs: 10, auth: { getClient: () => new Promise(resolve => { finish = resolve; }) },
    fetchImpl: async () => { calls++; return json({ values: [] }); } });
  await assert.rejects(slow.read()); finish(await auth.getClient());
  await new Promise(resolve => setImmediate(resolve)); assert.equal(calls, 0);
});

async function api(t, options = {}) {
  const s = sheet();
  const server = createApp({ authorizedSub: 'owner', verify: async token => token === 'test.owner.sig' ? 'owner' : 'other',
    processCommitments: s.processor(), ...options });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  return { s, origin, request: (options = {}, route = '/api/compromisos/procesar') => fetch(`${origin}${route}`,
    { method: 'POST', ...options, headers: { Authorization: 'Bearer test.owner.sig', ...options.headers } }) };
}

for (const method of ['BBVA Crédito', 'BBVA Débito']) {
  test(`controlled HTTP rehearsal: monthly commitment with ${method}, no external fetch`, async t => {
    const nativeFetch = globalThis.fetch;
    let allowedOrigin, blockedCalls = 0;
    // Installed before constructing the app: an accidentally uninjected Sheets
    // client must fail rather than fall back to a real Google fetch.
    t.mock.method(globalThis, 'fetch', (input, options) => {
      const url = new URL(input instanceof Request ? input.url : input);
      if (url.origin !== allowedOrigin || url.pathname !== '/api/compromisos/procesar') {
        blockedCalls++;
        throw new Error('External fetch forbidden in controlled rehearsal');
      }
      return nativeFetch(input, options);
    });
    const { s, origin, request } = await api(t);
    allowedOrigin = origin;
    const commitment = row(); commitment[5] = method;
    const rule = [...row()]; rule[0] = 'Regla ficticia'; rule[1] = 'Regla operativa';
    // A complete, overdue rule proves exclusion is by type, not missing fields.
    s.rows = [header, [...commitment], [...rule]];
    const first = await request();
    assert.equal(first.status, 200); assert.equal(first.headers.get('cache-control'), 'no-store');
    assert.deepEqual((await first.json()).resultados, [
      { compromiso: commitment[0], fechaProgramada: '2032-09-18', proximaFecha: '2032-10-18', estado: 'procesado' },
      { compromiso: rule[0], estado: 'omitido', motivo: 'regla_operativa' }
    ]);
    assert.equal(s.movements.length, 1);
    assert.deepEqual(s.movements[0].slice(0, 9), ['2032-09-18', '00:00', 'Gasto', 'Servicios', 12.34,
      commitment[0], method, '', 'Jarvis']);
    assert.match(s.movements[0][9], /Generado automáticamente desde Compromisos/);
    assert.equal(s.rows[1][7], serial('2032-09-18'));
    assert.equal(s.rows[1][4], serial('2032-10-18'));
    assert.deepEqual(s.rows[2], rule);
    assert.equal(s.ledger.length, 1); assert.equal(s.ledger[0][2], 'registered');
    const snapshot = structuredClone({ rows: s.rows, movements: s.movements, ledger: s.ledger });
    const writes = s.calls.filter(call => call.method !== 'GET').length;

    const second = await request(); assert.equal(second.status, 200);
    assert.deepEqual((await second.json()).resultados, [
      { compromiso: commitment[0], estado: 'omitido', motivo: 'futuro' },
      { compromiso: rule[0], estado: 'omitido', motivo: 'regla_operativa' }
    ]);
    assert.deepEqual({ rows: s.rows, movements: s.movements, ledger: s.ledger }, snapshot);
    assert.equal(s.calls.filter(call => call.method !== 'GET').length, writes);

    // Also exercise persistent deduplication over HTTP, not only the future-date
    // shortcut: restore the original schedule in the in-memory fixture only.
    s.rows[1] = [...commitment];
    const retry = await request(); assert.equal(retry.status, 200);
    assert.equal((await retry.json()).resultados[0].estado, 'recuperado');
    assert.deepEqual({ rows: s.rows, movements: s.movements, ledger: s.ledger }, snapshot);
    assert.equal(blockedCalls, 0);
  });
}

test('authenticated endpoint integrates processor and Sheets writer, no-store on every repeated invocation', async t => {
  const { s, request } = await api(t);
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await request(); assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal((await response.json()).fecha, '2032-09-23');
  }
  assert.equal(s.movements.length, 1);
});

test('processor endpoint preserves authentication, Google sub authorization, body rejection and CORS', async t => {
  const { s, request } = await api(t);
  for (const [options, status] of [
    [{ headers: { Authorization: '' } }, 401], [{ headers: { Authorization: 'invalid' } }, 401],
    [{ headers: { Authorization: 'Bearer test.other.sig' } }, 403],
    [{ headers: { Origin: 'https://evil.example' } }, 403], [{ body: '{}' }, 400], [{ method: 'GET' }, 405]
  ]) {
    const response = await request(options); assert.equal(response.status, status);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  assert.equal((await request({}, '/api/compromisos/procesar?date=2032-10-01')).status, 404);
  const preflight = await request({ method: 'OPTIONS', headers: { Origin: 'http://localhost:8000',
    'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization' } });
  assert.equal(preflight.status, 204); assert.equal(preflight.headers.get('access-control-allow-methods'), 'POST');
  assert.equal(s.calls.length, 0);
  const unconfigured = await api(t, { authorizedSub: '' });
  assert.equal((await unconfigured.request()).status, 503); assert.equal(unconfigured.s.calls.length, 0);
});

test('processor endpoint sanitizes unavailable and busy responses', async t => {
  for (const [code, status, error] of [['SENSITIVE', 503, 'commitments_unavailable'], ['PROCESSOR_BUSY', 409, 'commitments_busy']]) {
    const { request } = await api(t, { processCommitments: async () => { throw Object.assign(new Error('private detail'), { code }); } });
    const response = await request(); assert.equal(response.status, status);
    assert.deepEqual(await response.json(), { error }); assert.equal(response.headers.get('cache-control'), 'no-store');
  }
});
