const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../dinero-libre.js'), 'utf8');
const data = { estado: 'completo', periodo: { inicio: '2034-03-02', fin: '2034-03-15' }, dineroDisponible: 900,
  compromisosApartados: 100, cortesPendientes: 100, dineroLibre: 700,
  compromisos: [{ nombre: 'Reserva <sintética>', monto: 100 }], cortes: [{ nombre: 'Crédito sintético', fechaCorte: '2034-03-01', monto: 100 }], pendientes: [] };
const incomplete = { ...data, estado: 'incompleto', dineroLibre: null, compromisosApartados: null,
  pendientes: [{ nombre: 'Cuenta <desconocida>', codigo: 'metodo_sin_confirmar' }] };
function setup() {
  const window = {}, root = { innerHTML: '' };
  const blocked = new Proxy({}, { get() { throw Error('No persistence'); }, set() { throw Error('No persistence'); } });
  vm.runInNewContext(source, { window, Intl, AbortController, localStorage: blocked, sessionStorage: blocked, indexedDB: blocked, caches: blocked, console: blocked });
  return { root, view: window.JarvisFreeMoney.mount(root) };
}
test('free money is primary, gross remains labeled, deductions and dynamic escaped breakdown render in MXN', async () => {
  const { root, view } = setup(); view.setReader(async () => data); await view.open();
  assert.match(root.innerHTML, /class="free-total">\$700.00/);
  for (const text of ['Dinero disponible', '$900.00', 'Compromisos apartados', 'Cortes pendientes', 'Reserva &lt;sintética&gt;', 'Crédito sintético', '2034-03-15']) assert.ok(root.innerHTML.includes(text));
  assert.doesNotMatch(root.innerHTML, /<sintética>|Cálculo incompleto/);
});
test('incomplete state never presents a guessed number as free money; reason and partial breakdown are explicit', async () => {
  const { root, view } = setup(); view.setReader(async () => incomplete); await view.open();
  assert.match(root.innerHTML, /class="free-total">Por confirmar/); assert.match(root.innerHTML, /Cálculo incompleto/);
  assert.match(root.innerHTML, /Cuenta &lt;desconocida&gt;/); assert.match(root.innerHTML, /Descuentos confirmados/);
  assert.doesNotMatch(root.innerHTML, /\$700.00/);
});
test('zero and negative free money are preserved, never clamped or replaced with available', async () => {
  const { root, view } = setup();
  for (const amount of [0, -50]) {
    view.setReader(async () => ({ ...data, dineroDisponible: amount + 200, dineroLibre: amount })); await view.open();
    assert.match(root.innerHTML, new RegExp(`class="free-total">${amount < 0 ? '-' : ''}\\$${Math.abs(amount)}.00`));
  }
});
test('malformed totals or incomplete payloads fail closed, with safe error and retry', async () => {
  const { root, view } = setup();
  for (const value of [{}, { ...data, dineroLibre: 999 }, { ...incomplete, dineroLibre: 700 }, { ...incomplete, pendientes: [] }]) {
    view.setReader(async () => value); await view.open(); assert.match(root.innerHTML, /No pudimos calcular/);
    assert.doesNotMatch(root.innerHTML, /\$999.00/);
  }
  view.setReader(async () => { throw Error('private'); }); await view.open(); assert.doesNotMatch(root.innerHTML, /private/);
  view.setReader(async () => data); root.onclick({ target: { closest: () => true } }); await new Promise(resolve => setImmediate(resolve));
  assert.match(root.innerHTML, /\$700.00/);
});
test('loading, cancellation, replacement and logout clear financial data and block late responses', async () => {
  const { root, view } = setup(); let finish, signal;
  const deferred = value => { signal = value; return new Promise(resolve => { finish = resolve; }); };
  view.setReader(deferred); const pending = view.open(); assert.match(root.innerHTML, /Cargando/); view.reset();
  assert.equal(signal.aborted, true); finish(data); await pending; assert.equal(root.innerHTML, '');
  view.setReader(deferred); const old = view.open(); view.setReader(async () => incomplete); await view.open();
  assert.equal(signal.aborted, true); finish(data); await old; assert.match(root.innerHTML, /Cálculo incompleto/);
});
test('new block is independently wired and uses responsive wrapping without embedded financial fixtures', () => {
  const css = fs.readFileSync(path.join(__dirname, '../styles.css'), 'utf8');
  assert.match(css, /\.free-total\{[^}]*clamp\([^}]*overflow-wrap:anywhere/);
  assert.match(css, /@media\(max-width:380px\)\{\.free-summary>div,\.free-details li\{grid-template-columns:minmax\(0,1fr\)/);
  assert.doesNotMatch(source, /BBVA|Mercado Pago|14000|2500|5000|localStorage|sessionStorage|indexedDB/);
  for (const file of ['index.html', 'sw.js', 'scripts/serve.cjs']) assert.ok(fs.readFileSync(path.join(__dirname, '..', file), 'utf8').includes('dinero-libre.js'));
});
