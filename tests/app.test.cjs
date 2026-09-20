const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('dashboard has its own screen and exit discards the view before showing login', () => {
  const elements = new Map();
  const element = selector => {
    if (!elements.has(selector)) elements.set(selector, { hidden: false, innerHTML: '', focus() {} });
    return elements.get(selector);
  };
  let options, disposed = 0;
  const window = { scrollTo() {}, JarvisDashboard: { render(root, state) { root.innerHTML = state === 'reset' ? '' : state; } },
    JarvisAuth: { mount(input) { options = input; return () => { disposed++; input.onDashboard('reset'); }; } } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8'), {
    window, document: { querySelector: element }
  });
  options.onDashboard('loading');
  assert.equal(element('#login-screen').hidden, true);
  assert.equal(element('#dashboard-screen').hidden, false);
  options.onDashboard('loaded', {});
  assert.equal(element('#login-screen').hidden, true);
  element('#exit-dashboard').onclick();
  assert.equal(disposed, 1);
  assert.equal(element('#dashboard-data').innerHTML, '');
  assert.equal(element('#login-screen').hidden, false);
  assert.equal(element('#dashboard-screen').hidden, true);
  options.onDashboard('loaded', {});
  options.onDashboard('reset');
  assert.equal(element('#login-screen').hidden, false);
  assert.equal(element('#dashboard-data').innerHTML, '');
});
