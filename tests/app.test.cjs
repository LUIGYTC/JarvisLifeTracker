const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('available money loads on Finance entry, refreshes on return, survives dashboard errors and clears on logout', async () => {
  const nodes = new Map();
  const get = key => {
    if (!nodes.has(key)) nodes.set(key, { hidden: false, innerHTML: '', focus() {}, setAttribute(name, value) { this[name] = value; } });
    return nodes.get(key);
  };
  const window = { scrollTo() {}, JarvisRutinas: { mount: () => ({ open() {}, reset() {} }) },
    JarvisTarjetas: { mount: () => ({ open() {}, reset() {} }) },
    JarvisCardExpenses: { mount: () => ({ open() {}, reset() {} }) },
    JarvisDashboard: { render(node, state) { node.innerHTML = state; } } };
  for (const file of ['dinero-disponible.js', 'navigation.js']) vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), { window, AbortController, Intl });
  const navigation = window.JarvisNavigation.mount({ innerHTML: '', querySelector: get }, () => {});
  let calls = 0;
  navigation.setAvailableMoneyReader(async () => ({ total: ++calls, cuentas: [{ nombre: 'Cuenta nueva', saldo: calls }] }));
  get('#module-finanzas').onclick(); assert.equal(calls, 0);
  navigation.update('loading'); assert.equal(calls, 0);
  get('#module-finanzas').onclick(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1); assert.match(get('#available-data').innerHTML, /Cuenta nueva/);
  navigation.update('error'); assert.match(get('#available-data').innerHTML, /\$1.00/);
  assert.equal(get('#dashboard-data').innerHTML, 'error');
  get('#finance-tarjetas').onclick(); assert.equal(get('#available-data').hidden, true);
  get('#finance-expenses').onclick(); assert.equal(get('#available-data').hidden, true);
  get('#finance-movimientos').onclick(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(get('#available-data').hidden, false); assert.equal(calls, 2);
  assert.match(get('#available-data').innerHTML, /\$2.00/);
  navigation.update('reset'); assert.equal(get('#available-data').innerHTML, '');
  get('#module-finanzas').onclick(); assert.equal(calls, 2);
});

test('global card expenses navigation loads authenticated reader, preserves other views and clears on logout', async () => {
  const nodes = new Map();
  const get = key => {
    if (!nodes.has(key)) nodes.set(key, { hidden: false, innerHTML: '', focus() {}, setAttribute(name, value) { this[name] = value; } });
    return nodes.get(key);
  };
  const window = { scrollTo() {}, JarvisRutinas: { mount: () => ({ open() {}, reset() {} }) },
    JarvisTarjetas: { mount: () => ({ open() {}, reset() {} }) },
    JarvisDashboard: { render(node, state) { node.innerHTML = state; } } };
  for (const file of ['dinero-disponible.js', 'gastos-tarjetas.js', 'navigation.js']) vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), { window, AbortController, Intl });
  const navigation = window.JarvisNavigation.mount({ innerHTML: '', querySelector: get }, () => {});
  let calls = 0;
  navigation.setCardExpensesReader(async () => { calls++; return { inicioPeriodo: '2036-02-01', finPeriodo: '2036-02-12', total: 0, numeroCompras: 0, categorias: [] }; });
  get('#finance-expenses').onclick(); assert.equal(calls, 0);
  navigation.update('loaded'); get('#module-finanzas').onclick(); get('#finance-expenses').onclick();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1); assert.equal(get('#expenses-data').hidden, false);
  assert.equal(get('#dashboard-data').hidden, true); assert.equal(get('#credit-data').hidden, true);
  assert.equal(get('#finance-expenses')['aria-pressed'], 'true'); assert.match(get('#expenses-data').innerHTML, /Mes actual hasta hoy/);
  navigation.update('loaded'); assert.equal(get('#expenses-data').hidden, false);
  get('#finance-movimientos').onclick(); assert.equal(get('#dashboard-data').innerHTML, 'loaded'); assert.equal(get('#expenses-data').hidden, true);
  get('#finance-tarjetas').onclick(); assert.equal(get('#credit-data').hidden, false);
  navigation.update('reset'); assert.equal(get('#expenses-data').innerHTML, '');
  get('#finance-expenses').onclick(); assert.equal(calls, 1);
});

test('Finance switches between movements and credit without losing dashboard; logout clears credit', () => {
  const nodes = new Map();
  const get = key => {
    if (!nodes.has(key)) nodes.set(key, { hidden: false, innerHTML: '', focus() {}, setAttribute(name, value) { this[name] = value; } });
    return nodes.get(key);
  };
  let opened = 0, reset = 0, reader;
  const root = { innerHTML: '', querySelector: get };
  const window = { JarvisAvailableMoney: { mount: () => ({ open() {}, reset() {}, setReader() {} }) }, JarvisCardExpenses: { mount: () => ({ open() {}, reset() {}, setReader() {} }) }, scrollTo() {}, JarvisRutinas: { mount: () => ({ reset() {}, open() {}, setReader() {} }) },
    JarvisTarjetas: { mount: () => ({ open() { opened++; }, reset() { reset++; }, setReader(value) { reader = value; } }) },
    JarvisDashboard: { render(node, state) { node.innerHTML = state === 'reset' ? '' : state; } } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../navigation.js'), 'utf8'), { window });
  const navigation = window.JarvisNavigation.mount(root, () => {});
  const read = () => {}; navigation.setTarjetasReader(read); assert.equal(reader, read);
  get('#finance-tarjetas').onclick(); assert.equal(opened, 0);
  navigation.update('loading'); get('#module-finanzas').onclick();
  assert.equal(opened, 0);
  get('#finance-tarjetas').onclick(); assert.equal(opened, 1);
  assert.equal(get('#credit-data').hidden, false); assert.equal(get('#dashboard-data').hidden, true);
  assert.equal(get('#finance-tarjetas')['aria-pressed'], 'true');
  navigation.update('loaded'); assert.equal(get('#credit-data').hidden, false);
  get('#finance-movimientos').onclick(); assert.equal(get('#dashboard-data').innerHTML, 'loaded');
  assert.equal(get('#dashboard-data').hidden, false); assert.equal(get('#credit-data').hidden, true);
  navigation.update('reset'); assert.equal(reset, 1);
  assert.equal(get('#credit-data').hidden, true);
});

test('authorized login enters Home, Finance and back preserve identity, logout discards it', () => {
  const elements = new Map();
  const element = selector => {
    if (!elements.has(selector)) elements.set(selector, { hidden: false, innerHTML: '', focus() {}, setAttribute(name, value) { this[name] = value; }, querySelector: element });
    return elements.get(selector);
  };
  let options, disposed = 0, mounts = 0;
  const window = { JarvisAvailableMoney: { mount: () => ({ open() {}, reset() {}, setReader() {} }) }, JarvisCardExpenses: { mount: () => ({ open() {}, reset() {}, setReader() {} }) }, scrollTo() {}, JarvisTarjetas: { mount() { return { reset() {}, open() {}, setReader() {} }; } }, JarvisRutinas: { mount() { return { reset() {}, open() {}, setReader() {} }; } }, JarvisDashboard: { render(root, state) { root.innerHTML = state === 'reset' ? '' : state; } },
    JarvisAuth: { mount(input) { mounts++; options = input; return () => { disposed++; input.onDashboard('reset'); }; } } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../navigation.js'), 'utf8'), { window });
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8'), {
    window, document: { querySelector: element }
  });
  options.onDashboard('loading');
  assert.equal(element('#login-screen').hidden, true);
  assert.equal(element('#jarvis-shell').hidden, false);
  assert.equal(element('#jarvis-home').hidden, false);
  assert.equal(element('#finance-view').hidden, true);
  options.onDashboard('loaded', {});
  assert.equal(element('#login-screen').hidden, true);
  assert.equal(element('#finance-view').hidden, true);
  element('#module-finanzas').onclick();
  assert.equal(element('#finance-view').hidden, false);
  assert.equal(element('#jarvis-home').hidden, true);
  assert.equal(element('#dashboard-data').innerHTML, 'loaded');
  element('#back-home').onclick();
  assert.equal(element('#jarvis-home').hidden, false);
  assert.equal(element('#finance-view').hidden, true);
  element('#module-rutinas').onclick();
  assert.equal(element('#rutinas-view').hidden, false);
  assert.equal(element('#finance-view').hidden, true);
  options.onDashboard('loaded', {});
  assert.equal(element('#rutinas-view').hidden, false);
  element('#rutinas-back').onclick();
  assert.equal(element('#jarvis-home').hidden, false);
  assert.equal(element('#rutinas-view').hidden, true);
  assert.equal(disposed, 0);
  assert.equal(mounts, 1);
  element('#module-finanzas').onclick();
  assert.equal(element('#dashboard-data').innerHTML, 'loaded');
  element('#close-session').onclick();
  assert.equal(disposed, 1);
  assert.equal(element('#dashboard-data').innerHTML, '');
  assert.equal(element('#login-screen').hidden, false);
  assert.equal(element('#jarvis-shell').hidden, true);
  options.onDashboard('loaded', {});
  options.onDashboard('reset');
  assert.equal(element('#login-screen').hidden, false);
  assert.equal(element('#dashboard-data').innerHTML, '');
});

test('future modules are disabled and completion or error stays in the selected view', () => {
  const nodes = new Map();
  const get = key => {
    if (!nodes.has(key)) nodes.set(key, { hidden: false, focus() {}, setAttribute(name, value) { this[name] = value; }, innerHTML: '' });
    return nodes.get(key);
  };
  const root = { hidden: true, innerHTML: '', querySelector: get };
  const window = { JarvisAvailableMoney: { mount: () => ({ open() {}, reset() {}, setReader() {} }) }, JarvisCardExpenses: { mount: () => ({ open() {}, reset() {}, setReader() {} }) }, scrollTo() {}, JarvisTarjetas: { mount() { return { reset() {}, open() {}, setReader() {} }; } }, JarvisRutinas: { mount() { return { reset() {}, open() {}, setReader() {} }; } }, JarvisDashboard: { render(content, state) { content.innerHTML = state === 'reset' ? '' : state; } } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../navigation.js'), 'utf8'), { window });
  const navigation = window.JarvisNavigation.mount(root, () => {});
  for (const id of ['casa', 'inversiones']) {
    assert.match(root.innerHTML, new RegExp(`id="module-${id}" disabled`));
    assert.equal(get(`#module-${id}`).onclick, undefined);
  }
  assert.equal((root.innerHTML.match(/Próximamente/g) || []).length, 2);
  get('#module-finanzas').onclick();
  assert.equal(root.hidden, true);
  navigation.update('loading');
  get('#module-finanzas').onclick();
  navigation.update('loaded', {});
  assert.equal(get('#finance-view').hidden, false);
  navigation.update('error');
  assert.equal(get('#dashboard-data').innerHTML, 'error');
  get('#back-home').onclick();
  assert.equal(get('#jarvis-home').hidden, false);
  navigation.update('reset');
  get('#module-finanzas').onclick();
  assert.equal(root.hidden, true);
  assert.equal(get('#dashboard-data').innerHTML, '');
});
