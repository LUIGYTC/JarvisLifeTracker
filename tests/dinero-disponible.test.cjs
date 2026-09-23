const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../dinero-disponible.js'), 'utf8');
const data = { total: 12.34, cuentas: [{ nombre: 'Nueva <cuenta>', saldo: 12.34 }, { nombre: 'Cero', saldo: 0 }] };
function setup() {
  const window = {}, root = { innerHTML: '' };
  const blocked = new Proxy({}, { get() { throw Error('Persistence forbidden'); }, set() { throw Error('Persistence forbidden'); } });
  vm.runInNewContext(source, { window, Intl, AbortController, localStorage: blocked, sessionStorage: blocked, indexedDB: blocked, caches: blocked, console: blocked });
  return { root, view: window.JarvisAvailableMoney.mount(root) };
}
test('dynamic accounts, zero, MXN and escaped names use generic lightweight icons without persistence', async () => {
  const { root, view } = setup(); view.setReader(async () => data); await view.open();
  for (const text of ['Dinero disponible', '$12.34', '$0.00', 'Nueva &lt;cuenta&gt;', 'Cero']) assert.ok(root.innerHTML.includes(text));
  assert.equal((root.innerHTML.match(/<svg /g) || []).length, 2);
  assert.doesNotMatch(root.innerHTML, /<cuenta>|Ahorros|Patrimonio|Balance|Disponible de crédito/);
});
test('empty dataset shows zero and no registered accounts; errors never show a fake zero', async () => {
  const { root, view } = setup(); view.setReader(async () => ({ total: 0, cuentas: [] })); await view.open();
  assert.match(root.innerHTML, /\$0.00/); assert.match(root.innerHTML, /Sin cuentas de débito registradas/);
  for (const invalid of [{}, { total: NaN, cuentas: [] }, { total: 1, cuentas: [{ nombre: '', saldo: 1 }] }]) {
    view.setReader(async () => invalid); await view.open(); assert.match(root.innerHTML, /No pudimos cargar/); assert.doesNotMatch(root.innerHTML, /\$0.00/);
  }
});
test('loading, sanitized error and retry fetch fresh data', async () => {
  const { root, view } = setup(); let calls = 0;
  view.setReader(async () => { if (++calls === 1) throw Error('private'); return data; });
  const pending = view.open(); assert.match(root.innerHTML, /Cargando/); await pending;
  assert.match(root.innerHTML, /role="alert"/); assert.doesNotMatch(root.innerHTML, /private/);
  root.onclick({ target: { closest: () => true } }); await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 2); assert.match(root.innerHTML, /\$12.34/);
});
test('logout and superseded requests abort; late responses cannot restore financial data', async () => {
  const { root, view } = setup(); let finish, signal;
  const deferred = value => { signal = value; return new Promise(resolve => { finish = resolve; }); };
  view.setReader(deferred); const pending = view.open(); view.reset();
  assert.equal(signal.aborted, true); finish(data); await pending; assert.equal(root.innerHTML, '');
  view.setReader(deferred); const old = view.open(); view.setReader(async () => ({ total: 0, cuentas: [] })); await view.open();
  assert.equal(signal.aborted, true); finish(data); await old; assert.doesNotMatch(root.innerHTML, /Nueva/);
});
test('responsive rules allow long names and amounts to wrap, with stacked narrow-screen amounts', () => {
  const css = fs.readFileSync(path.join(__dirname, '../styles.css'), 'utf8');
  assert.match(css, /\.available-accounts span\{overflow-wrap:anywhere\}/);
  assert.match(css, /\.available-total\{[^}]*clamp\([^}]*overflow-wrap:anywhere/);
  assert.match(css, /@media\(max-width:380px\)\{\.available-accounts li\{grid-template-columns:20px minmax\(0,1fr\)\}/);
  assert.doesNotMatch(source, /BBVA|Mercado Pago|localStorage|sessionStorage|indexedDB/);
});
