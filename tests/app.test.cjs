const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('authorized login enters Home, Finance and back preserve identity, logout discards it', () => {
  const elements = new Map();
  const element = selector => {
    if (!elements.has(selector)) elements.set(selector, { hidden: false, innerHTML: '', focus() {}, querySelector: element });
    return elements.get(selector);
  };
  let options, disposed = 0, mounts = 0;
  const window = { scrollTo() {}, JarvisDashboard: { render(root, state) { root.innerHTML = state === 'reset' ? '' : state; } },
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
    if (!nodes.has(key)) nodes.set(key, { hidden: false, focus() {}, innerHTML: '' });
    return nodes.get(key);
  };
  const root = { hidden: true, innerHTML: '', querySelector: get };
  const window = { scrollTo() {}, JarvisDashboard: { render(content, state) { content.innerHTML = state === 'reset' ? '' : state; } } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../navigation.js'), 'utf8'), { window });
  const navigation = window.JarvisNavigation.mount(root, () => {});
  for (const id of ['casa', 'rutinas', 'inversiones']) {
    assert.match(root.innerHTML, new RegExp(`id="module-${id}" disabled`));
    assert.equal(get(`#module-${id}`).onclick, undefined);
  }
  assert.equal((root.innerHTML.match(/Próximamente/g) || []).length, 3);
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
