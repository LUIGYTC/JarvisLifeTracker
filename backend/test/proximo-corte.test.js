import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { cutPeriod, mexicoToday, periodExpenses, combineCut, createNextCutReader } from '../src/proximo-corte.js';
import { createDashboardReader } from '../src/dashboard.js';
import { createMSIReader, parseMSI } from '../src/compras-msi.js';
import { createApp } from '../src/app.js';
import { SPREADSHEET_ID } from '../src/config.js';
const name = 'Tarjeta sintética Corte';
const card = { tarjeta: name, diaCorte: 17, utilizado: 987.65 };
const header = ['Fecha', 'Hora', 'Tipo', 'Categoría', 'Monto', 'Descripción', 'Método', 'Destino'];
const msiHeader = ['Compra', 'Tarjeta', 'Mensualidad', 'Mes actual', 'Meses totales', 'Próximo corte', 'Estado', 'Nota'];
const move = (fecha, monto = 11.11, tipo = 'Gasto', metodo = name) => [fecha, '12:00', tipo, 'Prueba', monto, 'Movimiento sintético', metodo];
const purchase = (fecha, mensualidad = 3.33, tarjeta = name, estado = 'Activo') => ['Artículo sintético', tarjeta, mensualidad, 2, 6, fecha, estado, 'private-note'];
const period = cutPeriod(17, '2034-06-08');

test('new internal movement types do not change next cut purchase calculations', () => {
  assert.equal(periodExpenses([header, move('2034-06-01'),
    [...move('2034-06-01', 80, 'Transferencia'), 'Otra cuenta'],
    [...move('2034-06-01', 80, 'Pago tarjeta', 'Cuenta origen'), name]], name, period), 11.11);
});

test('next cut includes today and begins the day after the previous cut, including month/year rollover', () => {
  assert.deepEqual(period, { fechaCorte: '2034-06-17', inicioPeriodo: '2034-05-18', finPeriodo: '2034-06-17' });
  assert.deepEqual(cutPeriod(17, '2034-06-17'), period);
  assert.deepEqual(cutPeriod(17, '2034-06-18'), { fechaCorte: '2034-07-17', inicioPeriodo: '2034-06-18', finPeriodo: '2034-07-17' });
  assert.deepEqual(cutPeriod(17, '2034-12-18'), { fechaCorte: '2035-01-17', inicioPeriodo: '2034-12-18', finPeriodo: '2035-01-17' });
  assert.deepEqual(cutPeriod(1, '2035-01-01'), { fechaCorte: '2035-01-01', inicioPeriodo: '2034-12-02', finPeriodo: '2035-01-01' });
});

for (const day of [28, 29, 30, 31]) {
  test(`cut day ${day} clamps independently in February, leap years, April and following month`, () => {
    for (const [year, febEnd] of [[2035, 28], [2036, 29]]) {
      const febDay = Math.min(day, febEnd);
      assert.deepEqual(cutPeriod(day, `${year}-02-10`), { fechaCorte: `${year}-02-${febDay}`, inicioPeriodo: day === 31 ? `${year}-02-01` : `${year}-01-${day + 1}`, finPeriodo: `${year}-02-${febDay}` });
      const march = cutPeriod(day, `${year}-03-01`);
      assert.equal(march.fechaCorte, `${year}-03-${day}`);
      assert.equal(march.inicioPeriodo, febDay === febEnd ? `${year}-03-01` : `${year}-02-${febDay + 1}`);
    }
    assert.equal(cutPeriod(day, '2035-04-01').fechaCorte, `2035-04-${Math.min(day, 30)}`);
    assert.equal(cutPeriod(day, '2035-05-01').fechaCorte, `2035-05-${day}`);
  });
}

test('cut uses Mexico City civil date across UTC midnight and rejects invalid dates or missing cut day', () => {
  assert.equal(mexicoToday(new Date('2034-06-18T05:59:59Z')), '2034-06-17');
  assert.equal(mexicoToday(new Date('2034-06-18T06:00:00Z')), '2034-06-18');
  for (const day of [null, undefined, 0, 32, 2.5, '17']) assert.throws(() => cutPeriod(day, '2034-06-08'));
  assert.throws(() => cutPeriod(17, '2034-02-30'));
});

test('period purchases include both endpoints and only exact card expenses, with no recent limit', () => {
  const values = [header, move('2034-05-18'), move('2034-06-17', 22.22),
    move('2034-05-17'), move('2034-06-18'), move('2034-06-01', 99, 'Ingreso'),
    ...['Other', name.toLowerCase(), name + ' ', ' ' + name].map(method => move('2034-06-01', 99, 'Gasto', method))];
  assert.equal(periodExpenses(values, name, period), 33.33);
  assert.equal(periodExpenses([header, ...Array.from({ length: 25 }, () => move('2034-06-01', 1))], name, period), 25);
  const serial = (Date.UTC(2034, 5, 1) - Date.UTC(1899, 11, 30)) / 86400000;
  assert.equal(periodExpenses([header, move(serial)], name, period), 11.11);
});

test('cut MSI includes only active exact-card installments on the precise cut date, then sums purchases plus MSI', () => {
  const data = parseMSI([msiHeader, purchase(period.fechaCorte), purchase(period.fechaCorte, 4.44),
    purchase('2034-07-17', 88), purchase(null, 88), purchase(period.fechaCorte, 88, 'Other'),
    purchase(period.fechaCorte, 88, name, 'Finalizado'), purchase(period.fechaCorte, 88, name, 'activo')], name);
  assert.deepEqual(combineCut(period, 33.33, data, name), { ...period, comprasNormales: 33.33, msi: 7.77, totalAcumulado: 41.1 });
});

test('cards with no purchases, no MSI or neither return the corresponding zeros', () => {
  const none = parseMSI([], name), active = parseMSI([msiHeader, purchase(period.fechaCorte)], name);
  assert.equal(periodExpenses([], name, period), 0);
  assert.equal(combineCut(period, 0, active, name).totalAcumulado, 3.33);
  assert.equal(combineCut(period, 11.11, none, name).totalAcumulado, 11.11);
  assert.deepEqual(combineCut(period, 0, none, name), { ...period, comprasNormales: 0, msi: 0, totalAcumulado: 0 });
});

test('invalid matching rows, malformed sources and unsafe combined money never produce partial totals', () => {
  for (const monto of [NaN, Infinity, -1, 0.001, 'money']) assert.throws(() => periodExpenses([header, move('2034-06-01', monto)], name, period));
  assert.throws(() => periodExpenses([header, move('bad date')], name, period));
  assert.throws(() => periodExpenses([['wrong header']], name, period));
  assert.throws(() => periodExpenses([header, null], name, period));
  assert.throws(() => combineCut(period, 60000000000000, { tarjeta: name, compras: [{ proximoCorte: period.fechaCorte, mensualidad: 60000000000000 }] }, name));
  assert.throws(() => combineCut(period, 1, { tarjeta: 'Other', compras: [] }, name));
  assert.throws(() => parseMSI([msiHeader, purchase(period.fechaCorte, -1)], name));
});

test('next cut reads the real fixed sources afresh each query, never snapshot debt or closed-cut history', async () => {
  const rows = [header, move('2034-06-01')], paths = [];
  const options = { auth: { getClient: async () => ({ getRequestHeaders: async () => ({}) }) }, fetchImpl: async (url, request) => {
    const path = decodeURIComponent(url.pathname); paths.push(path);
    assert.equal(request.method, 'GET'); assert.equal(request.cache, 'no-store'); assert.equal(request.redirect, 'error');
    const root = `/v4/spreadsheets/${SPREADSHEET_ID}/values/`;
    assert.ok([root + "'Movimientos'!A:H", root + "'ComprasMSI'!A:H"].includes(path));
    return { status: 200, json: async () => ({ values: path.endsWith("'Movimientos'!A:H") ? rows : [msiHeader, purchase(period.fechaCorte)] }) };
  } };
  const reader = createNextCutReader({ now: () => new Date('2034-06-08T18:00:00Z'), readMSI: createMSIReader(options),
    readExpenses: (name, period) => createDashboardReader({ ...options, aggregate: values => periodExpenses(values, name, period) })() });
  const first = await reader(card); assert.equal(first.totalAcumulado, 14.44);
  rows.push(move('2034-06-02', 5.55));
  assert.equal((await reader({ ...card, utilizado: 99999 })).totalAcumulado, 19.99);
  assert.equal(paths.length, 4);
});

test('next cut API enforces authentication, card validation, no-store, CORS and fixed input with no writes', async t => {
  let reads = 0, writes = 0, fail = false, day = 17;
  const server = createApp({ authorizedSub: 'owner', verify: async token => {
    if (token === 'test.invalid.signature') throw Error('invalid'); return token === 'test.owner.signature' ? 'owner' : 'other';
  }, readTarjetas: async () => ({ tarjetas: [{ ...card, diaCorte: day }] }),
  readNextCut: async input => { reads++; assert.deepEqual(input, { tarjeta: name, diaCorte: day }); if (fail) throw Error('private'); return combineCut(period, 0, parseMSI([], name), name); },
  writeMovement: async () => { writes++; return true; } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}/api/tarjetas-credito/proximo-corte`, url = `${base}?${new URLSearchParams({ tarjeta: name })}`;
  for (const [token, code] of [['', 401], ['test.invalid.signature', 401], ['test.other.signature', 403]]) assert.equal((await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} })).status, code);
  const headers = { Authorization: 'Bearer test.owner.signature', Origin: 'https://luigytc.github.io' };
  for (const query of ['', '?tarjeta=x&range=A:Z', '?tarjeta=x&fecha=2034-01-01', '?tarjeta=x&tarjeta=y']) assert.equal((await fetch(base + query, { headers })).status, 400);
  assert.equal((await fetch(base + '?tarjeta=unknown', { headers })).status, 404);
  assert.equal((await fetch(url, { method: 'POST', headers })).status, 405);
  assert.equal((await fetch(url, { headers: { ...headers, Origin: 'https://evil.test' } })).status, 403);
  assert.equal((await fetch(url, { method: 'OPTIONS', headers: { Origin: headers.Origin, 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'Authorization' } })).status, 204);
  assert.equal(reads, 0);
  const response = await fetch(url, { headers }); assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store'); assert.equal(response.headers.get('access-control-allow-origin'), headers.Origin);
  assert.deepEqual(await response.json(), { ...period, comprasNormales: 0, msi: 0, totalAcumulado: 0 });
  day = null; assert.equal((await fetch(url, { headers })).status, 422);
  day = 17; fail = true; const error = await fetch(url, { headers }); assert.equal(error.status, 503);
  assert.deepEqual(await error.json(), { error: 'next_cut_unavailable' }); assert.equal(writes, 0);
});
