const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../tarjetas-credito.js'), 'utf8');
const settle = () => new Promise(resolve => setImmediate(resolve));
const card = (overrides = {}) => ({ tarjeta: 'Sintética A', tipo: 'Crédito', limite: 1000, utilizado: 100,
  disponible: 900, porcentajeUtilizacion: 10, diaCorte: 15, ultimaActualizacion: null,
  fechaLimitePago: '2032-01-25', domiciliadaA: null, ...overrides });
function setup() {
  const forbidden = () => { throw new Error('Unexpected persistence or logging'); };
  const blocked = new Proxy({}, { get: forbidden, set: forbidden });
  const document = {};
  Object.defineProperty(document, 'cookie', { get: forbidden, set: forbidden });
  const window = {};
  vm.runInNewContext(source, { window, document, Intl, AbortController, localStorage: blocked,
    sessionStorage: blocked, indexedDB: blocked, caches: blocked, console: blocked });
  const root = { innerHTML: '' };
  const view = window.JarvisTarjetas.mount(root);
  return { root, view };
}

test('credit overview loads lazily, renders MXN and uses utilized debt shares rather than limits', async () => {
  const { root, view } = setup(); let calls = 0;
  view.setReader(async () => { calls++; return { tarjetas: [card(), card({ tarjeta: 'Sintética B', utilizado: 300, limite: 1000, disponible: 700, porcentajeUtilizacion: 30 })] }; });
  assert.equal(calls, 0);
  const pending = view.open(); view.open();
  assert.match(root.innerHTML, /Cargando tarjetas/);
  await pending; await view.open(); assert.equal(calls, 1);
  assert.match(root.innerHTML, /Distribución de deuda/);
  assert.match(root.innerHTML, /stroke-dasharray="25 75"/);
  assert.match(root.innerHTML, /stroke-dasharray="75 25"/);
  assert.match(root.innerHTML, /\$400\.00/);
  for (const value of ['Sintética A', 'Sintética B', '$100.00', '$300.00', '$1,000.00', '$900.00', '10% de utilización', 'Día de corte', 'Fecha límite de pago']) assert.ok(root.innerHTML.includes(value));
  assert.equal((root.innerHTML.match(/class="card credit-card" tabindex="0"/g) || []).length, 2);
  assert.doesNotMatch(root.innerHTML, /href=|<form|<input|onclick=/);
});

test('credit cards handle empty and zero debt without invalid donut segments or invented dates', async () => {
  const { root, view } = setup();
  view.setReader(async () => ({ tarjetas: [] })); await view.open();
  assert.match(root.innerHTML, /No hay tarjetas de crédito registradas/);
  assert.doesNotMatch(root.innerHTML, /<svg/);
  view.setReader(async () => ({ tarjetas: [card({ utilizado: 0, porcentajeUtilizacion: 0, fechaLimitePago: null, diaCorte: null })] }));
  await view.open();
  assert.match(root.innerHTML, /Sin deuda utilizada/);
  assert.doesNotMatch(root.innerHTML, /NaN|Infinity|stroke-dasharray|Fecha límite de pago/);
  assert.match(root.innerHTML, /Sin registrar/);
});

test('credit overview escapes source labels and never renders unrelated or hidden sensitive fields', async () => {
  const { root, view } = setup();
  view.setReader(async () => ({ tarjetas: [card({ tarjeta: '<img src=x onerror=alert(1)>',
    numero: 'synthetic-secret-number', credential: 'synthetic-secret-token', domiciliadaA: 'synthetic-private-account' })] }));
  await view.open();
  assert.match(root.innerHTML, /&lt;img/);
  assert.doesNotMatch(root.innerHTML, /<img|synthetic-secret|synthetic-private/);
});

test('credit API errors and malformed payloads show generic retry state', async () => {
  const { root, view } = setup();
  for (const value of [null, {}, { tarjetas: [null] }, { tarjetas: [card({ utilizado: 'bad' })] },
    { tarjetas: [card({ fechaLimitePago: '2032-02-30' })] }, { tarjetas: [card({ porcentajeUtilizacion: Infinity })] }]) {
    view.setReader(async () => value); await view.open();
    assert.match(root.innerHTML, /No se pudieron cargar tus tarjetas/);
  }
  let fail = true;
  view.setReader(async () => { if (fail) throw new Error('private-error'); return { tarjetas: [card()] }; });
  await view.open(); assert.doesNotMatch(root.innerHTML, /private-error/);
  fail = false;
  root.onclick({ target: { closest: () => ({}) } }); await settle();
  assert.match(root.innerHTML, /Sintética A/);
});

test('reset or replacing the reader aborts pending loads and stale results cannot restore card data', async () => {
  const { root, view } = setup();
  const pending = [];
  const reader = signal => new Promise(resolve => pending.push({ signal, resolve }));
  view.setReader(reader); const first = view.open();
  view.reset(); assert.equal(pending[0].signal.aborted, true);
  pending[0].resolve({ tarjetas: [card()] }); await first;
  assert.equal(root.innerHTML, ''); await view.open(); assert.equal(pending.length, 1);
  view.setReader(reader); const second = view.open();
  view.setReader(async () => ({ tarjetas: [] })); await view.open();
  assert.equal(pending[1].signal.aborted, true);
  pending[1].resolve({ tarjetas: [card()] }); await second;
  assert.match(root.innerHTML, /No hay tarjetas/); assert.doesNotMatch(root.innerHTML, /Sintética/);
});

test('credit frontend has no embedded card fixtures or persistence and is wired into public assets', () => {
  assert.doesNotMatch(source, /BBVA|Rappi|Mercado Pago|Liverpool|Sintética|2032-01-25|localStorage|sessionStorage|indexedDB|document\.cookie|caches\./i);
  assert.match(fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8'), /src="\.\/tarjetas-credito\.js"/);
});
