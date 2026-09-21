const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
function setup() {
  const window = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../rutinas.js'), 'utf8'), { window });
  const root = { innerHTML: '', contains: () => true, querySelector() { return { focus() {} }; } };
  const calendar = window.JarvisRutinas.mount(root, () => new Date(2024, 0, 31, 12));
  const click = dataset => root.onclick({ target: { closest: () => ({ dataset }) } });
  return { api: window.JarvisRutinas, root, calendar, click };
}
test('calendar handles leap years, century rules, month lengths and Monday offset', () => {
  const { api } = setup();
  for (const [year, month, count, offset] of [[2024,1,29,3],[2023,1,28,2],[1900,1,28,3],[2000,1,29,1],[2026,8,30,1],[2024,8,30,6],[2024,0,31,0]]) {
    const result = api.monthDays(year, month);
    assert.equal(result.count, count);
    assert.equal(result.offset, offset);
  }
});
test('month controls cross years, clamp selection and return to local current day', () => {
  const { root, click } = setup();
  click({ action: 'next' });
  assert.match(root.innerHTML, /febrero de 2024/);
  assert.match(root.innerHTML, /data-day="29"[^>]*aria-pressed="true"/);
  click({ action: 'previous' });
  click({ action: 'previous' });
  assert.match(root.innerHTML, /diciembre de 2023/);
  click({ action: 'next' });
  assert.match(root.innerHTML, /enero de 2024/);
  click({ action: 'today' });
  assert.match(root.innerHTML, /data-day="31"[^>]*aria-pressed="true" aria-current="date"/);
});
test('day selection updates accessible selection and empty detail without creating records', () => {
  const { root, click, calendar } = setup();
  click({ day: '22' });
  assert.match(root.innerHTML, /data-day="22"[^>]*aria-pressed="true"/);
  assert.equal((root.innerHTML.match(/aria-pressed="true"/g) || []).length, 1);
  assert.match(root.innerHTML, /lunes, 22 de enero de 2024/);
  assert.match(root.innerHTML, /Sin información registrada/);
  assert.doesNotMatch(root.innerHTML, /<form|<input/);
  calendar.reset();
  assert.match(root.innerHTML, /data-day="31"[^>]*aria-pressed="true"/);
});
