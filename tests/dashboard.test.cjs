const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../dashboard.js'), 'utf8');
test('dashboard renders safe labels, MXN, all charts and privacy reset without storage', () => {
  const window = {};
  const forbidden = new Proxy({}, { get() { throw new Error('Unexpected persistence or logging'); } });
  vm.runInNewContext(source, { window, Intl, localStorage: forbidden, sessionStorage: forbidden, indexedDB: forbidden, console: forbidden });
  const root = { innerHTML: '', replaceChildren() { this.innerHTML = ''; } };
  const data = { summary: { ingresos: 10, gastos: 5, balance: 5, movimientos: 1 },
    byCategory: [{ categoria: '<img onerror=x>', total: 5 }], byPaymentMethod: [{ metodo: 'Prueba', total: 5 }],
    daily: [{ fecha: '2026-09-20', ingresos: 10, gastos: 5 }],
    recent: [{ fecha: '2026-09-20', tipo: 'Gasto', categoria: '<img onerror=x>', monto: 5, descripcion: '<script>x</script>', metodo: 'Prueba' }] };
  window.JarvisDashboard.render(root, 'loading'); assert.match(root.innerHTML, /Cargando datos/);
  window.JarvisDashboard.render(root, 'loaded', data);
  for (const label of ['Tus movimientos', 'Gastos por categoría', 'Ingresos vs gastos por día', 'Gastos por método', 'Movimientos recientes', '$10.00']) assert.ok(root.innerHTML.includes(label));
  assert.doesNotMatch(root.innerHTML, /demo|demostración/i);
  assert.doesNotMatch(root.innerHTML, /<script>|<img/);
  assert.match(root.innerHTML, /&lt;script&gt;/);
  window.JarvisDashboard.render(root, 'reset'); assert.equal(root.innerHTML, '');
  window.JarvisDashboard.render(root, 'error'); assert.match(root.innerHTML, /No pudimos cargar tus datos/);
  window.JarvisDashboard.render(root, 'loaded', { summary: { ingresos: 0, gastos: 0, balance: 0, movimientos: 0 }, byCategory: [], byPaymentMethod: [], daily: [], recent: [] });
  assert.match(root.innerHTML, /Sin movimientos/);
  window.JarvisDashboard.render(root, 'demo');
  assert.match(root.innerHTML, /Inicia sesión para cargar tus movimientos/);
  assert.doesNotMatch(root.innerHTML, /demo|demostración/i);
});
