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

function action(root, selector, index, key) {
  const target = { closest: value => value === selector ? { dataset: { creditCard: String(index) } } : null };
  if (key) root.onkeydown({ target, key, preventDefault() {} });
  else root.onclick({ target });
}
const movement = { fecha: '2032-01-20', descripcion: 'Compra sintética', categoria: 'Prueba', monto: 12.34, tipo: 'Gasto' };
const syntheticMSI = { compra: 'Artículo sintético Alfa', mensualidad: 20.1, mesActual: 2, mesesTotales: 8, proximoCorte: '2034-02-15' };
const syntheticCut = { fechaCorte: '2034-06-17', inicioPeriodo: '2034-05-18', finPeriodo: '2034-06-17', comprasNormales: 33.33, msi: 7.77, totalAcumulado: 41.1 };

test('next cut highlights accumulated total and breakdown independently from current balance', async () => {
  const { root, view } = setup(); const calls = [];
  view.setReader(async () => ({ tarjetas: [card()] }));
  view.setNextCutReader(async name => { calls.push(name); return syntheticCut; });
  await view.open(); assert.equal(calls.length, 0); action(root, '[data-credit-card]', 0); await settle();
  const section = root.innerHTML.split('class="card section credit-next-cut"')[1].split('class="card section credit-cut"')[0];
  for (const label of ['Próximo corte', 'Total acumulado', '$41.10', 'Compras del periodo', '$33.33', 'MSI', '$7.77', 'Periodo:', '18 may 2034', '17 jun 2034']) assert.ok(section.includes(label), label);
  assert.doesNotMatch(section, /Saldo actual|saldo al corte|pago mínimo|deuda total|pago para no generar intereses/i);
  assert.match(root.innerHTML, /Saldo actual/); assert.deepEqual(calls, ['Sintética A']);
  action(root, '[data-credit-back]'); action(root, '[data-credit-card]', 0); await settle(); assert.equal(calls.length, 2);
});

test('next cut handles zero totals and absent cut day without fabricated dates or requests', async () => {
  const { root, view } = setup(); let calls = 0;
  view.setReader(async () => ({ tarjetas: [card({ diaCorte: null })] }));
  view.setNextCutReader(async () => { calls++; return syntheticCut; }); await view.open(); action(root, '[data-credit-card]', 0); await settle();
  assert.match(root.innerHTML, /No hay día de corte registrado/); assert.equal(calls, 0);
  view.setReader(async () => ({ tarjetas: [card()] })); view.setNextCutReader(async () => ({ ...syntheticCut, comprasNormales: 0, msi: 0, totalAcumulado: 0 }));
  await view.open(); action(root, '[data-credit-card]', 0); await settle(); assert.match(root.innerHTML, /\$0\.00/);
});

test('next cut failures and malformed totals stay generic while other detail sections remain usable', async () => {
  const { root, view } = setup(); let fail = true;
  view.setReader(async () => ({ tarjetas: [card()] }));
  view.setMovementsReader(async tarjeta => ({ tarjeta, movimientos: [movement] }));
  view.setNextCutReader(async () => { if (fail) throw Error('private-error'); return syntheticCut; });
  await view.open(); action(root, '[data-credit-card]', 0); await settle();
  assert.match(root.innerHTML, /No se pudo calcular el próximo corte/); assert.match(root.innerHTML, /Compra sintética/); assert.doesNotMatch(root.innerHTML, /private-error/);
  fail = false; action(root, '[data-credit-cut-retry]'); await settle(); assert.match(root.innerHTML, /\$41\.10/);
  view.setNextCutReader(async () => ({ ...syntheticCut, totalAcumulado: 1 })); action(root, '[data-credit-cut-retry]'); await settle();
  assert.match(root.innerHTML, /No se pudo calcular el próximo corte/);
});

test('next cut responses cannot restore a detail after back, another selection or logout', async () => {
  const { root, view } = setup(); const pending = [];
  view.setReader(async () => ({ tarjetas: [card(), card({ tarjeta: 'Sintética B' })] }));
  view.setNextCutReader((name, signal) => new Promise(resolve => pending.push({ name, signal, resolve })));
  await view.open(); action(root, '[data-credit-card]', 0); action(root, '[data-credit-back]'); action(root, '[data-credit-card]', 1);
  assert.equal(pending[0].signal.aborted, true); pending[0].resolve(syntheticCut); await settle();
  assert.match(root.innerHTML, /Sintética B/); assert.doesNotMatch(root.innerHTML, /\$41\.10/);
  view.reset(); assert.equal(pending[1].signal.aborted, true); pending[1].resolve(syntheticCut); await settle(); assert.equal(root.innerHTML, '');
});

test('MSI section displays only active installment commitment separately from current balance and movements', async () => {
  const { root, view } = setup(); const calls = [];
  view.setReader(async () => ({ tarjetas: [card()] }));
  view.setMovementsReader(async tarjeta => ({ tarjeta, movimientos: [movement] }));
  view.setMSIReader(async tarjeta => { calls.push(tarjeta); return { tarjeta, totalMensualMSI: 50.3, compras: [syntheticMSI,
    { ...syntheticMSI, compra: 'Artículo sintético Beta', mensualidad: 30.2 }] }; });
  await view.open(); assert.equal(calls.length, 0); action(root, '[data-credit-card]', 0); await settle();
  const msiSection = root.innerHTML.split('class="card section credit-msi"')[1].split('class="card section credit-movements"')[0];
  for (const label of ['MSI activos', 'Comprometido en próximo corte', '$50.30', '$20.10', '$30.20', '2 de 8', '15 feb 2034', '/ mes']) assert.ok(msiSection.includes(label), label);
  assert.doesNotMatch(msiSection, /Compra sintética|Saldo actual|saldo al corte|pago del corte|deuda total/i);
  const movementSection = root.innerHTML.split('class="card section credit-movements"')[1];
  assert.match(movementSection, /Compra sintética/); assert.doesNotMatch(movementSection, /Artículo sintético/);
  assert.match(root.innerHTML, /Saldo actual/); assert.deepEqual(calls, ['Sintética A']);
});

test('MSI empty state and errors preserve card data and independently loaded movements', async () => {
  const { root, view } = setup(); let fail = false;
  view.setReader(async () => ({ tarjetas: [card()] }));
  view.setMovementsReader(async tarjeta => ({ tarjeta, movimientos: [movement] }));
  view.setMSIReader(async tarjeta => { if (fail) throw Error('private-provider-error'); return { tarjeta, totalMensualMSI: 0, compras: [] }; });
  await view.open(); action(root, '[data-credit-card]', 0); await settle();
  assert.match(root.innerHTML, /No hay compras a MSI activas/);
  fail = true; action(root, '[data-credit-back]'); action(root, '[data-credit-card]', 0); await settle();
  assert.match(root.innerHTML, /No se pudieron cargar los MSI/); assert.match(root.innerHTML, /Compra sintética/);
  assert.doesNotMatch(root.innerHTML, /private-provider-error/);
  fail = false; action(root, '[data-credit-msi-retry]'); await settle();
  assert.match(root.innerHTML, /No hay compras a MSI activas/);
});

test('MSI rendering rejects mismatched cards or totals and escapes purchase labels without exposing Nota', async () => {
  const { root, view } = setup();
  view.setReader(async () => ({ tarjetas: [card()] })); await view.open();
  for (const payload of [{ tarjeta: 'Other', totalMensualMSI: 20.1, compras: [syntheticMSI] },
    { tarjeta: 'Sintética A', totalMensualMSI: 99, compras: [syntheticMSI] },
    { tarjeta: 'Sintética A', totalMensualMSI: 20.1, compras: [{ ...syntheticMSI, mesActual: 10 }] }]) {
    view.setMSIReader(async () => payload); action(root, '[data-credit-card]', 0); await settle();
    assert.match(root.innerHTML, /No se pudieron cargar los MSI/);
  }
  view.setMSIReader(async tarjeta => ({ tarjeta, totalMensualMSI: 20.1, compras: [{ ...syntheticMSI, compra: '<img src=x>', nota: 'private-note' }] }));
  action(root, '[data-credit-card]', 0); await settle();
  assert.match(root.innerHTML, /&lt;img src=x&gt;/); assert.doesNotMatch(root.innerHTML, /<img|private-note/);
});

test('MSI pending requests abort on back and reset; late results never restore another card or closed view', async () => {
  const { root, view } = setup(); const pending = [];
  view.setReader(async () => ({ tarjetas: [card(), card({ tarjeta: 'Sintética B' })] }));
  view.setMSIReader((tarjeta, signal) => new Promise(resolve => pending.push({ tarjeta, signal, resolve })));
  await view.open(); action(root, '[data-credit-card]', 0); await settle();
  action(root, '[data-credit-back]'); assert.equal(pending[0].signal.aborted, true);
  action(root, '[data-credit-card]', 1);
  pending[0].resolve({ tarjeta: pending[0].tarjeta, totalMensualMSI: 20.1, compras: [syntheticMSI] }); await settle();
  assert.match(root.innerHTML, /Sintética B/); assert.doesNotMatch(root.innerHTML, /Artículo sintético Alfa/);
  view.reset(); assert.equal(pending[1].signal.aborted, true);
  pending[1].resolve({ tarjeta: pending[1].tarjeta, totalMensualMSI: 20.1, compras: [syntheticMSI] }); await settle();
  assert.equal(root.innerHTML, '');
});

test('MSI source contains no synthetic fixtures, persistence or automatic expense registration', () => {
  assert.doesNotMatch(source, /Artículo sintético|2034-02-15|localStorage|sessionStorage|indexedDB|document\.cookie|\/api\/movimientos|method:\s*['"]POST/);
});

test('click and keyboard open the selected card with current balance, recorded fields and its movements', async () => {
  const { root, view } = setup(); const calls = [];
  view.setReader(async () => ({ tarjetas: [card(), card({ tarjeta: 'Sintética B', utilizado: 250, disponible: 750,
    porcentajeUtilizacion: 25, domiciliadaA: 'Cuenta sintética', ultimaActualizacion: '2032-01-22' })] }));
  view.setMovementsReader(async name => { calls.push(name); return { tarjeta: name, movimientos: [movement] }; });
  await view.open();
  action(root, '[data-credit-card]', 1); await settle();
  for (const label of ['Sintética B', 'Saldo actual', '$250.00', '$750.00', '$1,000.00', '25% de utilización', 'Día de corte', 'Fecha límite de pago', 'Cuenta sintética', 'Fecha base', '22 ene 2032', 'Compra sintética', '$12.34', 'Gasto']) assert.ok(root.innerHTML.includes(label), label);
  assert.doesNotMatch(root.innerHTML, /Sintética A|Pago del corte|Próximo pago|Pago estimado|Pago para no generar intereses|Número de tarjeta/);
  assert.deepEqual(calls, ['Sintética B']);
  action(root, '[data-credit-back]'); action(root, '[data-credit-card]', 0, 'Enter'); await settle();
  assert.deepEqual(calls, ['Sintética B', 'Sintética A']);
});

test('card detail accepts a payment as a distinct movement type without treating it as a purchase', async () => {
  const { root, view } = setup();
  view.setReader(async () => ({ tarjetas: [card()] }));
  view.setMovementsReader(async tarjeta => ({ tarjeta, movimientos: [{ ...movement, tipo: 'Pago tarjeta', categoria: '', descripcion: 'Pago sintético' }] }));
  await view.open(); action(root, '[data-credit-card]', 0); await settle();
  assert.match(root.innerHTML, /Pago tarjeta/); assert.match(root.innerHTML, /Pago sintético/);
  assert.doesNotMatch(root.innerHTML, /No se pudieron cargar los movimientos/);
});

test('return restores the unchanged overview without refetch or login; missing fields and movements stay empty', async () => {
  const { root, view } = setup(); let reads = 0;
  view.setReader(async () => { reads++; return { tarjetas: [card({ fechaLimitePago: null, diaCorte: null })] }; });
  view.setMovementsReader(async tarjeta => ({ tarjeta, movimientos: [] })); await view.open();
  const overview = root.innerHTML;
  action(root, '[data-credit-card]', 0, ' '); await settle();
  assert.match(root.innerHTML, /Aún no hay movimientos registrados con esta tarjeta/);
  assert.match(root.innerHTML, /Fecha base/); assert.match(root.innerHTML, /Sin registrar/);
  assert.doesNotMatch(root.innerHTML, /Fecha límite de pago|Domiciliada a/);
  action(root, '[data-credit-back]'); assert.equal(root.innerHTML, overview); assert.equal(reads, 1);
});

test('detail escapes fields, omits sensitive extras and rejects mismatched card responses', async () => {
  const { root, view } = setup();
  view.setReader(async () => ({ tarjetas: [card({ tipo: '<img>', domiciliadaA: '<script>', numero: 'secret-number' })] }));
  view.setMovementsReader(async tarjeta => ({ tarjeta, movimientos: [{ ...movement, descripcion: '<img>', categoria: '<script>', origen: 'secret-origin', textoOriginal: 'secret-original' }] }));
  await view.open(); action(root, '[data-credit-card]', 0); await settle();
  assert.match(root.innerHTML, /&lt;img&gt;/); assert.match(root.innerHTML, /&lt;script&gt;/);
  assert.doesNotMatch(root.innerHTML, /<img>|<script>|secret-/);
  action(root, '[data-credit-back]');
  view.setMovementsReader(async () => ({ tarjeta: 'Otra tarjeta', movimientos: [movement] }));
  action(root, '[data-credit-card]', 0); await settle();
  assert.match(root.innerHTML, /No se pudieron cargar los movimientos/); assert.doesNotMatch(root.innerHTML, /Compra sintética/);
});

test('back, switching cards and reset abort detail reads and ignore late responses', async () => {
  const { root, view } = setup(); const pending = [];
  view.setReader(async () => ({ tarjetas: [card(), card({ tarjeta: 'Sintética B' })] }));
  view.setMovementsReader((tarjeta, signal) => new Promise(resolve => pending.push({ tarjeta, signal, resolve })));
  await view.open(); action(root, '[data-credit-card]', 0);
  action(root, '[data-credit-back]'); assert.equal(pending[0].signal.aborted, true);
  action(root, '[data-credit-card]', 1);
  pending[0].resolve({ tarjeta: pending[0].tarjeta, movimientos: [movement] }); await settle();
  assert.match(root.innerHTML, /Sintética B/); assert.doesNotMatch(root.innerHTML, /Compra sintética/);
  view.reset(); assert.equal(pending[1].signal.aborted, true);
  pending[1].resolve({ tarjeta: pending[1].tarjeta, movimientos: [movement] }); await settle();
  assert.equal(root.innerHTML, '');
});

test('movement failures leave card information visible and retry does not reload the overview', async () => {
  const { root, view } = setup(); let fail = true, reads = 0;
  view.setReader(async () => { reads++; return { tarjetas: [card()] }; });
  view.setMovementsReader(async tarjeta => { if (fail) throw Error('private-failure'); return { tarjeta, movimientos: [movement] }; });
  await view.open(); action(root, '[data-credit-card]', 0); await settle();
  assert.match(root.innerHTML, /Saldo actual/); assert.match(root.innerHTML, /No se pudieron cargar los movimientos/);
  assert.doesNotMatch(root.innerHTML, /private-failure/);
  fail = false; action(root, '[data-credit-movements-retry]'); await settle();
  assert.match(root.innerHTML, /Compra sintética/); assert.equal(reads, 1);
});
