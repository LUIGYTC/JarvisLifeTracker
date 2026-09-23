import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../src/app.js';
import { cardMovements, createCardMovementsReader, tarjetaSelection } from '../src/tarjeta-movimientos.js';
import { SPREADSHEET_ID } from '../src/config.js';
const header = ['Fecha', 'Hora', 'Tipo', 'Categoría', 'Monto', 'Descripción', 'Método', 'Destino'];
const row = (method, day = 1) => [`2032-01-${String(day).padStart(2, '0')}`, '12:00', 'Gasto', 'Prueba', 10.1, `Sintético ${day}`, method, '', 'private-origin', 'private-original'];

test('card payments are selected by destination, not the debit source, and retain their non-expense type', () => {
  const payment = ['2032-01-02', '12:00', 'Pago tarjeta', '', 25, 'Pago sintético', 'Cuenta A', 'Crédito A'];
  assert.equal(cardMovements([header, payment], 'Crédito A').movimientos[0].tipo, 'Pago tarjeta');
  assert.deepEqual(cardMovements([header, payment], 'Cuenta A').movimientos, []);
});

test('card movements match Metodo exactly before limiting to ten, sorted newest first', () => {
  const rows = [header, ...Array.from({ length: 15 }, (_, i) => row('Sintética A', i + 1)),
    ...Array.from({ length: 25 }, () => row('Sintética B', 31)), row('sintética a'), row('Sintética A '), row(' Sintética A')];
  const data = cardMovements(rows, 'Sintética A');
  assert.equal(data.tarjeta, 'Sintética A'); assert.equal(data.movimientos.length, 10);
  assert.deepEqual(data.movimientos.map(item => item.descripcion), Array.from({ length: 10 }, (_, i) => `Sintético ${15 - i}`));
  assert.deepEqual(Object.keys(data.movimientos[0]), ['fecha', 'descripcion', 'categoria', 'monto', 'tipo']);
  assert.doesNotMatch(JSON.stringify(data), /private-|Origen|Texto original|Sintética B/);
  assert.deepEqual(cardMovements(rows, 'Sin registros').movimientos, []);
  const income = row('Sintética A'); income[2] = 'Ingreso';
  assert.equal(cardMovements([header, income], 'Sintética A').movimientos[0].tipo, 'Ingreso');
});

test('card selection rejects missing, duplicated and arbitrary range parameters', () => {
  for (const query of ['', 'tarjeta=', 'tarjeta=A&tarjeta=B', 'tarjeta=A&range=A:Z', 'range=A:J', `tarjeta=${'a'.repeat(101)}`]) {
    assert.throws(() => tarjetaSelection(new URLSearchParams(query)));
  }
  assert.equal(tarjetaSelection(new URLSearchParams({ tarjeta: 'Prueba + & Crédito' })), 'Prueba + & Crédito');
  assert.throws(() => cardMovements([['invalid'], row('A')], 'A'));
  const bad = row('A'); bad[4] = 1.001;
  assert.throws(() => cardMovements([header, bad], 'A'));
});

test('card movements reader uses ADC and only the fixed real Movimientos A:H source', async () => {
  const reader = createCardMovementsReader({ auth: { getClient: async () => ({ getRequestHeaders: async () => ({ Authorization: 'synthetic-adc' }) }) },
    fetchImpl: async (url, options) => {
      assert.equal(decodeURIComponent(url.pathname), `/v4/spreadsheets/${SPREADSHEET_ID}/values/'Movimientos'!A:H`);
      assert.equal(options.method, 'GET'); assert.equal(options.cache, 'no-store'); assert.equal(options.redirect, 'error');
      assert.equal(options.headers.Authorization, 'synthetic-adc');
      return { status: 200, json: async () => ({ values: [header, row('A'), row('B')] }) };
    } });
  assert.equal((await reader('A')).movimientos.length, 1);
});

test('card movements endpoint authenticates before reads and validates selection against existing cards', async t => {
  let cardsRead = 0, movesRead = 0, fail = false;
  const server = createApp({ authorizedSub: 'owner', verify: async token => {
    if (token === 'test.invalid.signature') throw Error('invalid');
    return token === 'test.owner.signature' ? 'owner' : 'other';
  }, readTarjetas: async () => { cardsRead++; return { tarjetas: [{ tarjeta: 'Sintética A' }] }; },
  readCardMovements: async name => { movesRead++; if (fail) throw Error('private'); return cardMovements([header, row(name)], name); } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}/api/tarjetas-credito/movimientos`;
  const url = `${base}?${new URLSearchParams({ tarjeta: 'Sintética A' })}`;
  for (const [token, status] of [['', 401], ['test.invalid.signature', 401], ['test.other.signature', 403]]) {
    assert.equal((await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} })).status, status);
  }
  assert.equal(cardsRead, 0); assert.equal(movesRead, 0);
  const headers = { Authorization: 'Bearer test.owner.signature', Origin: 'https://luigytc.github.io' };
  assert.equal((await fetch(url, { headers: { ...headers, Origin: 'https://evil.test' } })).status, 403);
  assert.equal((await fetch(url, { headers, method: 'POST' })).status, 405);
  const preflight = await fetch(url, { method: 'OPTIONS', headers: { Origin: headers.Origin, 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'Authorization' } });
  assert.equal(preflight.status, 204); assert.equal(cardsRead, 0);
  for (const query of ['', '?tarjeta=A&range=A:Z', '?tarjeta=A&tarjeta=B']) {
    assert.equal((await fetch(base + query, { headers })).status, 400);
  }
  assert.equal(cardsRead, 0);
  assert.equal((await fetch(base + '?tarjeta=Unknown', { headers })).status, 404); assert.equal(movesRead, 0);
  const response = await fetch(url, { headers });
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('access-control-allow-origin'), headers.Origin);
  assert.deepEqual(await response.json(), cardMovements([header, row('Sintética A')], 'Sintética A'));
  fail = true; const error = await fetch(url, { headers });
  assert.equal(error.status, 503); assert.deepEqual(await error.json(), { error: 'card_movements_unavailable' });
});
