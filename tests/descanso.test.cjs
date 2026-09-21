const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const window = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../descanso.js'), 'utf8'), { window });
const { calculate } = window.JarvisDescanso;
const block = (start, end, fechaTurno = end.slice(0, 10)) => ({ inicioReal: start + ':00', finReal: end + ':00', fechaTurno });
test('08 and 07 shifts produce configured wake, ideal and minimum civil times', () => {
  for (const [hour, wake, ideal, minimum] of [['08','06','22','2032-03-01T00:00:00'], ['07','05','21','2032-02-29T23:00:00']]) {
    const [r] = calculate([block(`2032-03-01T${hour}:00`, '2032-03-01T16:00')]);
    assert.equal(r.despertar, `2032-03-01T${wake}:00:00`);
    assert.equal(r.ventana.inicio, `2032-02-29T${ideal}:00:00`);
    assert.equal(r.limiteMinimo, minimum); assert.equal(r.estado, 'ideal');
  }
});
test('overnight uses physical start, not operational date, including year boundary', () => {
  const [r] = calculate([block('2032-12-31T23:00', '2033-01-01T07:00')]);
  assert.equal(r.fechaTurno, '2033-01-01');
  assert.equal(r.despertar, '2032-12-31T21:00:00');
  assert.equal(r.ventana.inicio, '2032-12-31T13:00:00');
});
test('chronological blocks classify 8, 7, 6 and under 6 hours without crossing work', () => {
  for (const [end, expected] of [['21','ideal'], ['22','reducido'], ['23','reducido']]) {
    const items = [block('2032-03-01T07:00', '2032-03-01T15:00'), block('2032-02-29T15:00', `2032-02-29T${end}:00`)];
    const r = calculate(items).at(-1);
    assert.equal(r.estado, expected);
    assert.ok(r.ventana.inicio >= items[1].finReal);
  }
  const r = calculate([block('2032-02-29T23:00','2032-03-01T07:00'), block('2032-03-01T12:00','2032-03-01T20:00')]).at(-1);
  assert.equal(r.estado, 'recuperacion_prioritaria');
  assert.equal(r.limiteMinimo, null);
  assert.equal(r.ventana.inicio, '2032-03-01T07:00:00');
});
test('overlapping blocks retain latest end and never offer a sleep interval through work', () => {
  const items = [block('2032-03-01T07:00','2032-03-01T20:00'), block('2032-03-01T08:00','2032-03-01T10:00'), block('2032-03-01T18:00','2032-03-01T23:00')];
  const result = calculate(items);
  assert.equal(result[1].ventana, null); assert.equal(result[2].ventana, null);
  assert.equal(result[2].estado, 'recuperacion_prioritaria');
});
test('empty days have no invented wake; pure engine rejects invalid physical timestamps', () => {
  assert.equal(calculate([]).length, 0);
  const items = [block('2032-03-01T08:00','2032-03-01T16:00')];
  const original = JSON.stringify(items); calculate(items); assert.equal(JSON.stringify(items), original);
  assert.throws(() => calculate([block('2032-02-30T08:00','2032-03-01T16:00')]));
  assert.throws(() => calculate(items, { preparacionHoras: -1 }));
});
