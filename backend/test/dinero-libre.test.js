import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { calculateFreeMoney, createFreeMoneyReader, fortnight, FREE_MONEY_RANGES } from '../src/dinero-libre.js';
import { createApp } from '../src/app.js';
import { readConfig } from '../src/config.js';
const CH = ['Compromiso', 'Tipo', 'Monto', 'Frecuencia', 'Día / regla', 'Método', 'Estado', 'Último pago'];
const DH = ['Tarjeta', 'Inicio periodo', 'Fin periodo', 'Fecha corte', 'Fecha límite'];
const AH = ['Total corte', 'Monto pagado', 'Saldo pendiente', 'Estado', 'Fecha de pago', 'Última actualización'];
const MH = ['Fecha', 'Hora', 'Tipo', 'Categoría', 'Monto', 'Descripción', 'Método'];
const base = { available: { total: 900, cuentas: [{ nombre: 'Cuenta sintética', saldo: 900 }] }, today: '2034-03-10', anchor: '2034-03-02' };
const commitment = (changes = {}) => Object.assign(['Reserva sintética', 'Gasto fijo', 100, 'Mensual', 'Día 12', 'Cuenta sintética', 'Activo', ''], changes);
const cutDate = ['Crédito sintético', '2034-02-01', '2034-02-28', '2034-03-01', '2034-03-14'];
const cutAmount = [150, 50, 100, 'Parcial', '2034-03-04', '2034-03-06'];
const expense = (changes = {}) => Object.assign(['2034-03-08', '12:00', 'Gasto', 'Prueba', 100, 'Texto libre', 'Efectivo'], changes);
const calculate = options => calculateFreeMoney({ ...base, ...options });

test('true 14-day periods support boundaries, earlier dates and leap years without assuming quincenas', () => {
  assert.deepEqual(fortnight('2034-03-15', '2034-03-02'), { inicio: '2034-03-02', fin: '2034-03-15' });
  assert.deepEqual(fortnight('2034-03-16', '2034-03-02'), { inicio: '2034-03-16', fin: '2034-03-29' });
  assert.deepEqual(fortnight('2034-03-01', '2034-03-02'), { inicio: '2034-02-16', fin: '2034-03-01' });
  assert.deepEqual(fortnight('2032-02-29', '2032-02-27'), { inicio: '2032-02-27', fin: '2032-03-11' });
  assert.throws(() => fortnight('2034-02-30', '2034-03-02'));
  assert.equal(readConfig({ FORTNIGHT_ANCHOR: '2034-03-02' }).fortnightAnchor, '2034-03-02');
  assert.equal(readConfig({}).fortnightAnchor, '');
});

test('available minus pending commitments minus real residual cut; savings use recorded per-period amount', () => {
  const data = calculate({ commitments: [CH, commitment(), commitment({ 0: 'Reserva futura', 1: 'Ahorro', 2: 60, 4: '$30 por catorcena' })],
    cutDates: [DH, cutDate], cutAmounts: [AH, cutAmount] });
  assert.equal(data.estado, 'completo'); assert.equal(data.dineroDisponible, 900);
  assert.equal(data.compromisosApartados, 130); assert.equal(data.cortesPendientes, 100); assert.equal(data.dineroLibre, 670);
  assert.deepEqual(Object.keys(data.cortes[0]), ['nombre', 'fechaCorte', 'monto']);
  assert.equal(calculate({ available: { total: 1, cuentas: base.available.cuentas }, commitments: [CH, commitment()] }).dineroLibre, -99);
});

test('empty sources, zero balances and zero commitments produce valid zero, not invented cuts', () => {
  const data = calculate({ available: { total: 0, cuentas: [] } });
  assert.equal(data.estado, 'completo'); assert.equal(data.dineroLibre, 0); assert.deepEqual(data.cortes, []);
  assert.equal(calculate({ commitments: [CH, [], commitment({ 2: 0 })] }).compromisosApartados, 0);
});

test('explicit cash commitments and internal savings reserves do not require a named debit account', () => {
  assert.equal(calculate({ commitments: [CH, commitment({ 5: 'Efectivo' })] }).compromisosApartados, 100);
  assert.equal(calculate({ commitments: [CH, commitment({ 1: 'Ahorro', 4: '20 por catorcena', 5: '' })] }).compromisosApartados, 20);
});

test('paid commitments and paid cuts are never subtracted again with their recorded movements', () => {
  const data = calculate({ commitments: [CH, commitment({ 7: '2034-03-08' })],
    cutDates: [DH, cutDate], cutAmounts: [AH, [150, 150, 0, 'Pagado', '2034-03-08', '2034-03-08']], movements: [MH, expense()] });
  assert.equal(data.dineroLibre, 900); assert.equal(data.compromisosApartados, 0); assert.equal(data.cortesPendientes, 0);
});

test('payments from previous periods do not mark current commitments paid; inactive and out-of-period items excluded', () => {
  const data = calculate({ commitments: [CH, commitment({ 7: '2034-02-12' }), commitment({ 0: 'Inactivo', 6: 'Inactivo' }), commitment({ 0: 'Posterior', 4: 'Día 20' })] });
  assert.equal(data.compromisosApartados, 100);
  assert.equal(calculate({ commitments: [CH, commitment({ 4: 'Día 1' })] }).compromisosApartados, 0);
});

test('monthly commitments in a cross-month period use the occurrence month for payment reconciliation', () => {
  const data = calculate({ today: '2034-03-30', anchor: '2034-03-30', commitments: [CH, commitment({ 4: 'Día 5', 7: '2034-03-05' })] });
  assert.equal(data.compromisosApartados, 100);
  const leap = calculate({ today: '2032-02-28', anchor: '2032-02-27', commitments: [CH, commitment({ 4: 'Día 31' })] });
  assert.equal(leap.compromisosApartados, 100);
});

test('unconfirmed period, schedule or method returns null free money with explicit reasons', () => {
  for (const [options, reason] of [[{ anchor: '' }, 'periodo_sin_confirmar'], [{ commitments: [CH, commitment({ 4: 'Por confirmar' })] }, 'regla_sin_confirmar'],
    [{ commitments: [CH, commitment({ 5: '' })] }, 'metodo_sin_confirmar'], [{ commitments: [CH, commitment({ 5: 'Crédito sintético' })] }, 'metodo_sin_confirmar']]) {
    const data = calculate(options); assert.equal(data.estado, 'incompleto'); assert.equal(data.dineroLibre, null);
    assert.ok(data.pendientes.some(item => item.codigo === reason));
  }
});

test('unlinked payments including cash never cause guessed or double deductions; future and income rows do not settle payments', () => {
  const data = calculate({ commitments: [CH, commitment()], movements: [MH, expense()] });
  assert.equal(data.dineroLibre, null); assert.equal(data.compromisosApartados, null);
  assert.ok(data.pendientes.some(item => item.codigo === 'conciliar_compromiso'));
  assert.equal(calculate({ commitments: [CH, commitment()], movements: [MH, expense({ 2: 'Ingreso' }), expense({ 0: '2034-03-11' })] }).compromisosApartados, 100);
});

test('conflicting paid/pending status, future payment and duplicates are incomplete', () => {
  for (const row of [commitment({ 6: 'Pagado' }), commitment({ 7: '2034-03-11' }), commitment({ 6: 'Pendiente', 7: '2034-03-08' })]) {
    assert.equal(calculate({ commitments: [CH, row] }).dineroLibre, null);
  }
  assert.equal(calculate({ commitments: [CH, commitment(), commitment()] }).dineroLibre, null);
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
    { cutDates: [DH, cutDate], cutAmounts: [AH, cutAmount], movements: [MH, expense()] }
  ];
  for (const options of inputs) { const data = calculate(options); assert.equal(data.dineroLibre, null); assert.equal(data.cortesPendientes, null); }
});

test('invalid rows fail closed rather than displaying partial totals', () => {
  for (const options of [{ commitments: [CH, commitment({ 2: '100' })] }, { commitments: [['wrong']] },
    { movements: [MH, expense({ 0: '2034-02-30' })] }, { cutDates: [DH, cutDate], cutAmounts: [] },
    { commitments: [CH, commitment({ 2: 0.001 })] }, { movements: [MH, null] }]) assert.throws(() => calculate(options));
});

test('ADC reads only fixed sources in one no-store snapshot; no credit totals, MSI or forecast endpoints', async () => {
  let calls = 0;
  const data = [[['Tarjeta'], ['Cuenta sintética']], [['Saldo disponible'], [900]], [CH, commitment()], [DH, cutDate], [AH, cutAmount], [MH]];
  const reader = createFreeMoneyReader({ anchor: base.anchor, now: () => new Date('2034-03-10T12:00:00Z'),
    auth: { getClient: async () => ({ getRequestHeaders: async () => ({ Authorization: 'Bearer synthetic-adc' }) }) },
    fetchImpl: async (url, options) => {
      calls++; assert.deepEqual(url.searchParams.getAll('ranges'), FREE_MONEY_RANGES);
      assert.doesNotMatch(url.href, /TarjetasCredito|ComprasMSI/);
      assert.equal(url.searchParams.get('valueRenderOption'), 'UNFORMATTED_VALUE');
      assert.equal(options.cache, 'no-store'); assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'error');
      assert.equal(options.headers.Authorization, 'Bearer synthetic-adc');
      return { status: 200, json: async () => ({ valueRanges: data.map(values => ({ values })) }) };
    } });
  assert.equal((await reader()).dineroLibre, 700); await reader(); assert.equal(calls, 2);
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
