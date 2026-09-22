const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../gastos-tarjetas.js'), 'utf8');
const data = { inicioPeriodo: '2036-02-01', finPeriodo: '2036-02-12', total: 15, numeroCompras: 3,
  categorias: [{ categoria: 'Nueva <categoría>', total: 5, porcentaje: 100 / 3 }, { categoria: 'Comida', total: 10, porcentaje: 200 / 3 }] };
function setup() {
  const window = {}, root = { innerHTML: '' };
  const blocked = new Proxy({}, { get() { throw Error('Forbidden persistence'); }, set() { throw Error('Forbidden persistence'); } });
  vm.runInNewContext(source, { window, AbortController, Intl, localStorage: blocked, sessionStorage: blocked, indexedDB: blocked, document: blocked });
  return { root, view: window.JarvisCardExpenses.mount(root) };
}
test('expenses display MXN, explicit dates, totals, dynamic escaped legend and sorted top categories with matching colors', async () => {
  const { root, view } = setup(); view.setReader(async () => data); await view.open();
  assert.match(root.innerHTML, /Mes actual hasta hoy/); assert.match(root.innerHTML, /datetime="2036-02-01"/); assert.match(root.innerHTML, /datetime="2036-02-12"/);
  for (const text of ['Gastos con tarjetas', 'Total en tarjetas', 'Número de compras', 'Gastos por categoría', 'Top categorías', '$15.00', 'MXN', 'Nueva &lt;categoría&gt;']) assert.ok(root.innerHTML.includes(text));
  const top = root.innerHTML.split('expenses-top"><h2>')[1]; assert.ok(top.indexOf('Comida') < top.indexOf('Nueva &lt;categoría&gt;'));
  const segmentColors = [...root.innerHTML.matchAll(/fill="none" stroke="(#[a-f0-9]+)"/g)].map(match => match[1]);
  for (const color of segmentColors) { assert.ok(root.innerHTML.includes(`background:${color}`)); assert.ok(root.innerHTML.includes(`--category-color:${color}`)); }
  assert.doesNotMatch(root.innerHTML, /MSI|Por tarjeta|Próximo corte|<categoría>/);
});
test('empty state renders zero metrics and no invalid chart segments', async () => {
  const { root, view } = setup(); view.setReader(async () => ({ ...data, total: 0, numeroCompras: 0, categorias: [] })); await view.open();
  assert.match(root.innerHTML, /Aún no hay gastos con tarjetas en este periodo/); assert.match(root.innerHTML, /\$0.00/); assert.doesNotMatch(root.innerHTML, /NaN|Infinity|<circle/);
});
test('errors are generic and retry requests fresh data', async () => {
  const { root, view } = setup(); let count = 0;
  view.setReader(async () => { if (++count === 1) throw Error('sensitive'); return data; }); await view.open();
  assert.match(root.innerHTML, /No pudimos cargar/); assert.doesNotMatch(root.innerHTML, /sensitive/);
  root.onclick({ target: { closest: () => true } }); await new Promise(resolve => setImmediate(resolve));
  assert.match(root.innerHTML, /Top categorías/); assert.equal(count, 2);
});
test('reset aborts and clears financial content; late and superseded requests cannot repaint', async () => {
  const { root, view } = setup(); let resolve, signal;
  view.setReader(value => { signal = value; return new Promise(done => { resolve = done; }); });
  const pending = view.open(); view.reset(); assert.equal(signal.aborted, true); resolve(data); await pending; assert.equal(root.innerHTML, '');
  view.setReader(value => { signal = value; return new Promise(done => { resolve = done; }); });
  const first = view.open(); view.setReader(async () => ({ ...data, categorias: [], total: 0, numeroCompras: 0 })); await view.open();
  assert.equal(signal.aborted, true); resolve(data); await first; assert.match(root.innerHTML, /Aún no hay gastos/);
});
test('frontend carries no reference card data or financial persistence and uses lightweight SVG', () => {
  assert.doesNotMatch(source, /BBVA|Rappi|Liverpool|Mercado Pago|28450|40830|localStorage|sessionStorage|indexedDB|document\.cookie/);
  assert.match(source, /<svg/);
});
