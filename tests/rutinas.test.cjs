const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
function setup() {
  const window = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../rutinas.js'), 'utf8'), { window, AbortController });
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

const settle = () => new Promise(resolve => setImmediate(resolve));
const shift = (overrides = {}) => ({ fechaTurno: '2024-01-22', horaInicio: '23:00', horaFin: '07:00',
  tipo: 'Trabajo', estado: 'Confirmado', nota: '<img src=x onerror=alert(1)>',
  inicioReal: '2024-01-21T23:00:00', finReal: '2024-01-22T07:00:00', ...overrides });

test('opening loads visible month once; operational date and multiple blocks render safely', async () => {
  const { calendar, root, click } = setup();
  const calls = [];
  calendar.setReader(async (from, to) => { calls.push([from, to]); return { turnos: [shift(), shift({ horaInicio: '08:00', horaFin: '16:00', estado: 'Tentativo' })] }; });
  assert.equal(calls.length, 0);
  calendar.open(); calendar.open();
  assert.match(root.innerHTML, /Cargando turnos/);
  await settle(); calendar.open();
  assert.deepEqual(calls, [['2024-01-01', '2024-01-31']]);
  assert.match(root.innerHTML, /data-day="22"[^>]*aria-label="[^"]*, 2 turnos/);
  assert.doesNotMatch(root.innerHTML, /data-day="21"[^>]*aria-label="[^"]*turnos/);
  click({ day: '22' });
  assert.equal((root.innerHTML.match(/<article/g) || []).length, 2);
  assert.match(root.innerHTML, /23:00–07:00/); assert.match(root.innerHTML, /Tentativo/);
  assert.match(root.innerHTML, /&lt;img/); assert.doesNotMatch(root.innerHTML, /<img/);
  click({ day: '23' }); assert.match(root.innerHTML, /Sin información registrada/);
});

test('month changes request exact ranges; stale and post-logout responses cannot restore data', async () => {
  const { calendar, click, root } = setup();
  const pending = [];
  calendar.setReader((from, to, signal) => new Promise(resolve => pending.push({ from, to, signal, resolve })));
  calendar.open(); click({ action: 'next' });
  assert.deepEqual(pending.map(p => [p.from, p.to]), [['2024-01-01', '2024-01-31'], ['2024-02-01', '2024-02-29']]);
  assert.equal(pending[0].signal.aborted, true);
  pending[0].resolve({ turnos: [shift()] }); await settle();
  assert.doesNotMatch(root.innerHTML, /shift-summary/);
  calendar.reset(); assert.equal(pending[1].signal.aborted, true);
  pending[1].resolve({ turnos: [shift({ fechaTurno: '2024-02-22' })] }); await settle();
  assert.doesNotMatch(root.innerHTML, /shift-summary/);
  calendar.open(); assert.equal(pending.length, 2);
});

test('API failure and malformed response leave calendar usable; demo without reader stays local', async () => {
  const { calendar, root, click } = setup();
  calendar.open(); click({ action: 'next' });
  assert.match(root.innerHTML, /febrero de 2024/);
  calendar.setReader(async () => { throw new Error('private provider error'); });
  calendar.open(); await settle();
  assert.match(root.innerHTML, /No se pudieron cargar los turnos/);
  assert.doesNotMatch(root.innerHTML, /private provider/);
  click({ day: '5' }); assert.match(root.innerHTML, /aria-pressed="true"/);
  calendar.setReader(async () => ({ turnos: [shift({ horaInicio: '<script>' })] }));
  calendar.open(); await settle();
  assert.match(root.innerHTML, /No se pudieron cargar los turnos/);
});
