import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { calculateFreeMoney, createFreeMoneyReader, fortnight, FREE_MONEY_RANGES } from '../src/dinero-libre.js';
import { createApp } from '../src/app.js';
import { readConfig } from '../src/config.js';
const CH = ['Compromiso', 'Tipo', 'Monto', 'Frecuencia', 'Próxima fecha de pago', 'Método', 'Estado', 'Último pago'];
const DH = ['Tarjeta', 'Inicio periodo', 'Fin periodo', 'Fecha corte', 'Fecha límite'];
const AH = ['Total corte', 'Monto pagado', 'Saldo pendiente', 'Estado', 'Fecha de pago', 'Última actualización'];
const MH = ['Fecha', 'Hora', 'Tipo', 'Categoría', 'Monto', 'Descripción', 'Método', 'Destino'];
const base = { available: { total: 900, cuentas: [{ nombre: 'Cuenta sintética', saldo: 900 }] }, today: '2034-03-10', anchor: '2034-03-02' };
const commitment = (changes = {}) => Object.assign(['Reserva sintética', 'Gasto fijo', 100, 'Mensual', '2034-03-12', 'Cuenta sintética', 'Activo', ''], changes);
const cutDate = ['Crédito sintético', '2034-02-01', '2034-02-28', '2034-03-01', '2034-03-14'];
const cutAmount = [150, 50, 100, 'Parcial', '2034-03-04', '2034-03-06'];
const expense = (changes = {}) => Object.assign(['2034-03-08', '12:00', 'Gasto', 'Prueba', 100, 'Texto libre', 'Efectivo'], changes);
const calculate = options => calculateFreeMoney({ ...base, ...options });

test('native cut update timestamps are accepted, while same-day payments still require reconciliation', () => {
  const serial = (Date.UTC(2034, 2, 6) - Date.UTC(1899, 11, 30)) / 86400000;
  const cuts = { cutDates: [DH, cutDate], cutAmounts: [AH, [...cutAmount.slice(0, 5), serial + 0.75]] };
  assert.equal(calculate(cuts).cortesPendientes, 100);
  assert.equal(calculate(cuts).dineroLibre, 800);
  const pending = calculate({ ...cuts, movements: [MH, [...expense({ 0: '2034-03-06', 2: 'Pago tarjeta' }), 'Crédito sintético']] });
  assert.equal(pending.dineroLibre, null);
  assert.ok(pending.pendientes.some(item => item.codigo === 'conciliar_corte'));
});

test('empty historical cuts, with or without headers, never invent a pending amount or hide commitments', async () => {
  for (const [cutDates, cutAmounts] of [[[], []], [[DH], [AH]]]) {
    const data = calculate({ cutDates, cutAmounts, commitments: [CH, commitment()] });
    assert.equal(data.cortesPendientes, 0); assert.deepEqual(data.cortes, []);
    assert.equal(data.compromisosInformativos.length, 1); assert.equal(data.dineroLibre, null);
  }
  const values = [[['Cuenta'], ['Cuenta sintética']], [['Saldo disponible / valor actual'], [900]],
    [['Tipo'], ['Débito']], [CH, commitment()], undefined, undefined, [MH]];
  const reader = createFreeMoneyReader({ anchor: base.anchor, now: () => new Date('2034-03-10T12:00:00Z'),
    auth: { getClient: async () => ({ getRequestHeaders: async () => ({}) }) },
    fetchImpl: async () => ({ status: 200, json: async () => ({ valueRanges: values.map(values => values ? { values } : {}) }) }) });
  const data = await reader();
  assert.equal(data.cortesPendientes, 0); assert.deepEqual(data.cortes, []); assert.equal(data.compromisosInformativos.length, 1);
});

test('commitments are displayed without interpreting rules, reserving funds or executing payments', () => {
  const data = calculate({ commitments: [CH, commitment(), [], commitment({ 0: 'Otra regla', 3: 'Futura', 4: 'Por confirmar', 5: '' })] });
  assert.equal(data.estado, 'incompleto'); assert.equal(data.dineroLibre, null); assert.equal(data.compromisosApartados, null);
  assert.deepEqual(data.compromisos, []); assert.equal(data.compromisosInformativos.length, 2);
  assert.deepEqual(data.compromisosInformativos[0], { nombre: 'Reserva sintética', tipo: 'Gasto fijo', monto: 100,
    frecuencia: 'Mensual', proximaFechaPago: '2034-03-12', metodo: 'Cuenta sintética', estado: 'Activo' });
  assert.ok(data.pendientes.some(item => item.codigo === 'compromisos_solo_lectura'));
  assert.equal(calculate({}).dineroLibre, 900);
});

test('operating rules retain empty evaluated amounts as null without becoming fixed deductions', () => {
  for (const monto of ['', '   ', null, undefined]) {
    const rule = commitment({ 0: 'Pago de tarjetas', 1: 'Regla operativa', 2: monto, 5: 'CortesTarjeta' });
    const data = calculate({ commitments: [CH, commitment(), rule] });
    assert.equal(data.compromisosInformativos.length, 2);
    assert.deepEqual(data.compromisosInformativos[1], { nombre: 'Pago de tarjetas', tipo: 'Regla operativa',
      monto: null, frecuencia: 'Mensual', proximaFechaPago: '2034-03-12', metodo: 'CortesTarjeta', estado: 'Activo' });
    assert.equal(data.compromisosInformativos[0].monto, 100);
    assert.deepEqual(data.compromisos, []); assert.equal(data.compromisosApartados, null);
    assert.equal(data.dineroDisponible, 900); assert.equal(data.dineroLibre, null);
    assert.deepEqual(data.pendientes, [{ codigo: 'compromisos_solo_lectura', nombre: '' }]);
  }
  // The exception depends on Tipo, not on a special commitment name.
  assert.equal(calculate({ commitments: [CH, commitment({ 1: 'Regla operativa', 2: '' })] }).compromisosInformativos[0].monto, null);
});

test('active normal commitments still reject empty amounts and operating rules validate nonempty amounts', () => {
  for (const tipo of ['Gasto fijo', 'Apartado', 'Domiciliado', 'Suscripción']) {
    for (const monto of ['', ' ', null, undefined]) {
      assert.throws(() => calculate({ commitments: [CH, commitment({ 0: 'Pago de tarjetas', 1: tipo, 2: monto })] }), /Invalid free money data/);
    }
  }
  for (const monto of ['#VALUE!', '=IF(A1,1,"")', '100', -1, NaN, Infinity, 1.001]) {
    assert.throws(() => calculate({ commitments: [CH, commitment({ 1: 'Regla operativa', 2: monto })] }), /Invalid free money data/);
  }
  for (const monto of [0, 12.34]) {
    assert.equal(calculate({ commitments: [CH, commitment({ 1: 'Regla operativa', 2: monto })] }).compromisosInformativos[0].monto, monto);
  }
});

test('current Compromisos schema with an empty formula result survives Sheets reader and authenticated JSON', async t => {
  // Current ten-column layout, evaluated formula result and synthetic finances.
  const commitments = [[...CH, 'Nota', 'Origen'],
    [...commitment({ 0: 'Servicio ficticio', 1: 'Suscripción', 4: '12/03/2034' }), 'Nota privada', 'Origen privado'],
    [...commitment({ 0: 'Pago de tarjetas', 1: 'Regla operativa', 2: '', 4: '01/04/2034', 5: 'CortesTarjeta' }), 'Regla dinámica', 'Origen privado']];
  const values = [[['Cuenta'], ['Cuenta sintética']], [['Saldo disponible / valor actual'], [900]],
    [['Tipo'], ['Débito']], commitments, [DH], [AH], [MH]];
  let reads = 0;
  const readFreeMoney = createFreeMoneyReader({ anchor: base.anchor, now: () => new Date('2034-03-10T12:00:00Z'),
    auth: { getClient: async () => ({ getRequestHeaders: async () => ({}) }) },
    fetchImpl: async (url, options) => {
      reads++; assert.equal(options.method, 'GET'); assert.equal(options.cache, 'no-store');
      assert.equal(url.searchParams.get('valueRenderOption'), 'UNFORMATTED_VALUE');
      assert.deepEqual(url.searchParams.getAll('ranges'), FREE_MONEY_RANGES);
      // A:H excludes Nota and Origen, just as the actual reader requests.
      return { status: 200, json: async () => ({ valueRanges: values.map((rows, i) => ({ values: i === 3 ? rows.map(row => row.slice(0, 8)) : rows })) }) };
    } });
  const server = createApp({ authorizedSub: 'owner', verify: async () => 'owner', readFreeMoney });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const url = `http://127.0.0.1:${server.address().port}/api/dinero-libre`;
  const headers = { Authorization: 'Bearer test.owner.signature' };
  const response = await fetch(url, { headers });
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
  const data = await response.json();
  assert.equal(data.compromisosInformativos[1].monto, null);
  assert.equal(data.compromisosInformativos[1].nombre, 'Pago de tarjetas');
  assert.equal(data.compromisosInformativos[0].monto, 100);
  assert.equal(data.cortesPendientes, 0); assert.deepEqual(data.compromisos, []);
  assert.doesNotMatch(JSON.stringify(data), /Nota privada|Origen privado/);
  commitments[1][2] = ''; // Ordinary active subscription remains invalid.
  const invalid = await fetch(url, { headers });
  assert.equal(invalid.status, 503);
  assert.deepEqual(await invalid.json(), { error: 'free_money_unavailable' });
  assert.equal(reads, 2);
});

test('only card payments to the relevant destination trigger reconciliation, never transfers or ordinary expenses', () => {
  const cuts = { cutDates: [DH, cutDate], cutAmounts: [AH, cutAmount] };
  for (const row of [expense(), [...expense({ 2: 'Transferencia' }), 'Otra cuenta'], [...expense({ 2: 'Pago tarjeta' }), 'Otra tarjeta']]) {
    assert.equal(calculate({ ...cuts, movements: [MH, row] }).dineroLibre, 800);
  }
  assert.equal(calculate({ ...cuts, movements: [MH, [...expense({ 2: 'Pago tarjeta' }), 'Crédito sintético']] }).dineroLibre, null);
  assert.equal(calculate({ ...cuts, cutAmounts: [AH, [150, 150, 0, 'Pagado', '2034-03-08', '2034-03-08']],
    movements: [MH, [...expense({ 2: 'Pago tarjeta' }), 'Crédito sintético']] }).dineroLibre, 900);
});

test('reader uses current Cuentas types and evaluated balances, current Compromisos header and fixed read-only ranges', async () => {
  const values = [[['Cuenta'], ['Cuenta sintética'], ['Inversión sintética']], [['Saldo disponible / valor actual'], [900], [700]],
    [['Tipo'], ['Cuenta remunerada'], ['Inversión']], [CH, commitment()], [DH], [AH], [MH]];
  const reader = createFreeMoneyReader({ anchor: base.anchor, now: () => new Date('2034-03-10T12:00:00Z'),
    auth: { getClient: async () => ({ getRequestHeaders: async () => ({}) }) }, fetchImpl: async (url, options) => {
      assert.deepEqual(url.searchParams.getAll('ranges'), FREE_MONEY_RANGES);
      assert.doesNotMatch(url.href, /TarjetasDebito|TarjetasCredito|ComprasMSI/);
      assert.equal(options.method, 'GET'); assert.equal(options.cache, 'no-store');
      assert.equal(url.searchParams.get('valueRenderOption'), 'UNFORMATTED_VALUE');
      return { status: 200, json: async () => ({ valueRanges: values.map(values => ({ values })) }) };
    } });
  const data = await reader(); assert.equal(data.dineroDisponible, 900); assert.equal(data.dineroLibre, null);
  assert.equal(data.compromisosInformativos.length, 1);
});

test('true 14-day periods support boundaries, earlier dates and leap years without assuming quincenas', () => {
  assert.deepEqual(fortnight('2034-03-15', '2034-03-02'), { inicio: '2034-03-02', fin: '2034-03-15' });
  assert.deepEqual(fortnight('2034-03-16', '2034-03-02'), { inicio: '2034-03-16', fin: '2034-03-29' });
  assert.deepEqual(fortnight('2034-03-01', '2034-03-02'), { inicio: '2034-02-16', fin: '2034-03-01' });
  assert.deepEqual(fortnight('2032-02-29', '2032-02-27'), { inicio: '2032-02-27', fin: '2032-03-11' });
  assert.throws(() => fortnight('2034-02-30', '2034-03-02'));
  assert.equal(readConfig({ FORTNIGHT_ANCHOR: '2034-03-02' }).fortnightAnchor, '2034-03-02');
  assert.equal(readConfig({}).fortnightAnchor, '');
});

test('only real closed payable cuts count; open/estimated, paid and later due cuts do not', () => {
  for (const estado of ['Abierto', 'Estimado', 'Proyectado']) {
    assert.equal(calculate({ cutDates: [DH, cutDate], cutAmounts: [AH, [...cutAmount.slice(0, 3), estado, '', '']] }).cortesPendientes, 0);
  }
  assert.equal(calculate({ cutDates: [DH, [...cutDate.slice(0, 4), '2034-03-20']], cutAmounts: [AH, cutAmount] }).cortesPendientes, 0);
  assert.equal(calculate({ cutDates: [DH, [...cutDate.slice(0, 4), '2034-03-05']], cutAmounts: [AH, cutAmount] }).cortesPendientes, 100);
});

test('cut inconsistencies, duplicates, carry-over overlap and unconfirmed updates are incomplete', () => {
  const inputs = [
    { cutDates: [DH, cutDate], cutAmounts: [AH, [150, 50, 99, ...cutAmount.slice(3)]] },
    { cutDates: [DH, cutDate, cutDate], cutAmounts: [AH, cutAmount, cutAmount] },
    { cutDates: [DH, cutDate, ['Crédito sintético', '2034-01-01', '2034-01-31', '2034-02-01', '2034-02-14']], cutAmounts: [AH, cutAmount, cutAmount] },
    { cutDates: [DH, cutDate], cutAmounts: [AH, [...cutAmount.slice(0, 5), '']] },
    { cutDates: [DH, cutDate], cutAmounts: [AH, cutAmount], movements: [MH, [...expense({ 2: 'Pago tarjeta' }), 'Crédito sintético']] }
  ];
  for (const options of inputs) { const data = calculate(options); assert.equal(data.dineroLibre, null); assert.equal(data.cortesPendientes, null); }
});

test('reader sanitizes failures, missing ranges and timeout', async () => {
  const auth = { getClient: async () => ({ getRequestHeaders: async () => ({}) }) };
  for (const response of [{ status: 403 }, { status: 200, json: async () => ({ valueRanges: [] }) }]) {
    await assert.rejects(createFreeMoneyReader({ auth, fetchImpl: async () => response })(), /^Error: Free money unavailable$/);
  }
  await assert.rejects(createFreeMoneyReader({ auth: { getClient: () => new Promise(() => {}) }, timeoutMs: 5 })(), /^Error: Free money unavailable$/);
});

test('authenticated endpoint protects Google sub, CORS and no-store; response exposes no movements', async t => {
  let reads = 0, fail = false;
  const server = createApp({ authorizedSub: 'owner', verify: async token => token === 'test.owner.signature' ? 'owner' : 'other',
    readFreeMoney: async () => { reads++; if (fail) throw Error('private'); return calculate({}); } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); t.after(() => { server.closeAllConnections(); server.close(); });
  const url = `http://127.0.0.1:${server.address().port}/api/dinero-libre`;
  const headers = { Authorization: 'Bearer test.owner.signature', Origin: 'https://luigytc.github.io' };
  for (const [options, status] of [[{}, 401], [{ headers: { Authorization: 'Bearer test.other.signature' } }, 403],
    [{ headers: { ...headers, Origin: 'https://evil.test' } }, 403], [{ method: 'POST', headers }, 405]]) {
    const response = await fetch(url, options); assert.equal(response.status, status); assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  assert.equal(reads, 0);
  const response = await fetch(url, { headers }); assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('access-control-allow-origin'), headers.Origin);
  const data = await response.json(); assert.equal(data.dineroLibre, 900); assert.equal(data.movements, undefined);
  assert.equal((await fetch(url + '?range=Other', { headers })).status, 404);
  assert.equal((await fetch(url, { method: 'OPTIONS', headers: { Origin: headers.Origin, 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'Authorization' } })).status, 204);
  fail = true; const error = await fetch(url, { headers }); assert.equal(error.status, 503);
  assert.equal(error.headers.get('cache-control'), 'no-store'); assert.deepEqual(await error.json(), { error: 'free_money_unavailable' });
});
