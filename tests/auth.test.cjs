const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../auth.js'), 'utf8');
const settle = () => new Promise(resolve => setImmediate(resolve));

const controlledMovement = { fecha: '2026-09-20', hora: '12:00', tipo: 'Gasto', categoria: 'Prueba técnica',
  monto: 0.01, descripcion: 'PRUEBA CONTROLADA JARVIS 20260920-01', metodo: 'Prueba',
  origen: 'Verificación manual API', textoOriginal: 'Fila técnica explícita; no representa un gasto real' };

async function loginForTest(h, ui) {
  await settle();
  h.calls.button.click_listener();
  await h.calls.config.callback({ credential: 'synthetic-test-value' });
}

function temporaryHarness(options = {}) {
  const writes = [];
  const h = harness({ temporary: true, origin: 'https://luigytc.github.io', useConfig: true,
    confirm: options.confirm || (() => true), fetchImpl: async (url, init) => {
      if (url.endsWith('/auth/me')) return options.auth || { status: 200, json: async () => ({ authenticated: true, authorized: true }) };
      if (url.endsWith('/api/sheets/status')) return options.sheets || { status: 200, json: async () => ({ connected: true }) };
      writes.push({ url, init });
      return options.write ? options.write(url, init) : { status: 200, json: async () => ({ registered: true }) };
    } });
  return { ...h, writes };
}

test('temporary write requires authorization, Sheets connection and explicit confirmation', async () => {
  for (const options of [{ auth: { status: 403 } }, { sheets: { status: 503 } },
    { sheets: { status: 200, json: async () => ({ connected: false }) } }]) {
    const h = temporaryHarness(options);
    const ui = h.mount();
    assert.equal(ui.testWrite.hidden, true);
    await ui.testWrite.onclick();
    await loginForTest(h, ui);
    assert.equal(ui.testWrite.hidden, true);
    await ui.testWrite.onclick();
    assert.equal(h.writes.length, 0);
  }
  let accepted = false;
  let confirmations = 0;
  const h = temporaryHarness({ confirm: () => { confirmations++; return accepted; } });
  const ui = h.mount();
  await loginForTest(h, ui);
  assert.equal(ui.testWrite.hidden, false);
  await ui.testWrite.onclick();
  assert.equal(h.writes.length, 0);
  assert.equal(ui.testWrite.disabled, false);
  accepted = true;
  await ui.testWrite.onclick();
  assert.equal(confirmations, 2);
  assert.equal(h.writes.length, 1);
  assert.equal(ui.testStatus.textContent, 'Prueba registrada. Revisa el Sheet.');
  const { url, init } = h.writes[0];
  assert.equal(url, 'https://jarvislifetracker-505633966366.northamerica-south1.run.app/api/movimientos');
  assert.equal(init.method, 'POST');
  assert.equal(init.headers.Authorization, 'Bearer synthetic-test-value');
  assert.equal(init.headers['Content-Type'], 'application/json');
  assert.equal(init.credentials, 'omit');
  assert.equal(init.cache, 'no-store');
  assert.equal(init.redirect, 'error');
  assert.deepEqual(JSON.parse(init.body), controlledMovement);
});

test('temporary write latch prevents double click and survives new login and remount', async () => {
  let finish;
  const h = temporaryHarness({ write: () => new Promise(resolve => { finish = resolve; }) });
  let ui = h.mount();
  await loginForTest(h, ui);
  const pending = ui.testWrite.onclick();
  assert.equal(ui.testWrite.disabled, true);
  await ui.testWrite.onclick();
  assert.equal(h.writes.length, 1);
  finish({ status: 200, json: async () => ({ registered: true }) });
  await pending;
  await ui.testWrite.onclick();
  ui.clear.onclick();
  await loginForTest(h, ui);
  assert.equal(ui.testWrite.hidden, true);
  ui.dispose();
  ui = h.mount();
  await loginForTest(h, ui);
  await ui.testWrite.onclick();
  assert.equal(h.writes.length, 1);
});

test('temporary write network errors, timeouts and ambiguous replies never retry', async () => {
  for (const kind of ['network', 'timeout', 'malformed', 'extra', 'false', '503']) {
    const h = temporaryHarness({ write: async () => {
      if (kind === 'network') throw new Error('private details');
      if (kind === 'timeout') return new Promise(() => {});
      if (kind === 'malformed') return { status: 200, json: async () => { throw new Error('private'); } };
      if (kind === '503') return { status: 503, json: async () => ({ error: 'movement_unavailable' }) };
      return { status: 200, json: async () => kind === 'extra' ? { registered: true, extra: 'private' } : { registered: false } };
    } });
    const ui = h.mount();
    await loginForTest(h, ui);
    const pending = ui.testWrite.onclick();
    if (kind === 'timeout') [...h.timers.values()][0]();
    await pending;
    assert.equal(ui.testStatus.textContent, 'Resultado incierto. Revisa el Sheet antes de volver a intentar.');
    assert.equal(ui.testWrite.disabled, true);
    await ui.testWrite.onclick();
    assert.equal(h.writes.length, 1);
    assert.equal(h.timers.size, 0);
  }
});

test('temporary write reports only known pre-write rejection as generic failure', async () => {
  for (const [status, error] of [[401, 'invalid_identity'], [403, 'not_authorized'], [400, 'invalid_movement'],
    [413, 'invalid_movement'], [415, 'unsupported_media_type'], [503, 'authorization_unavailable']]) {
    const h = temporaryHarness({ write: async () => ({ status, json: async () => ({ error }) }) });
    const ui = h.mount();
    await loginForTest(h, ui);
    await ui.testWrite.onclick();
    assert.equal(ui.testStatus.textContent, 'No se pudo registrar la prueba.');
    await ui.testWrite.onclick();
    assert.equal(h.writes.length, 1);
  }
});

test('discard, exit, offline and demo invalidate temporary write readiness and late results', async () => {
  for (const action of ['discard', 'pagehide', 'offline', 'demo']) {
    for (const inFlight of [false, true]) {
      let finish;
      const h = temporaryHarness({ write: () => new Promise(resolve => { finish = resolve; }) });
      const ui = h.mount();
      await loginForTest(h, ui);
      const pending = inFlight ? ui.testWrite.onclick() : null;
      if (action === 'discard') ui.clear.onclick();
      if (action === 'pagehide') h.events.pagehide();
      if (action === 'offline') { h.navigator.onLine = false; h.events.offline(); }
      if (action === 'demo') ui.dispose();
      assert.equal(ui.testWrite.hidden, true);
      await ui.testWrite.onclick();
      assert.equal(h.writes.length, inFlight ? 1 : 0);
      if (inFlight) {
        assert.equal(h.writes[0].init.signal.aborted, true);
        finish({ status: 200, json: async () => ({ registered: true }) });
        await pending;
        assert.equal(ui.testStatus.textContent, 'Resultado incierto. Revisa el Sheet antes de volver a intentar.');
      }
    }
  }
});

function harness({ online = true, loaded = true, apiBaseUrl = '', origin = 'http://localhost:8000', useConfig = false, fetchImpl, temporary = false, confirm = () => false } = {}) {
  const events = {};
  const scripts = [];
  const timers = new Map();
  const calls = { initialize: 0 };
  const forbidden = () => { throw new Error('Unexpected storage, logging, decoding or API access'); };
  const window = { location: origin === 'null' ? new URL('file:///index.html') : new URL(origin), JarvisConfig: { apiBaseUrl }, addEventListener: (type, listener) => { events[type] = listener; } };
  if (useConfig) vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../config.js'), 'utf8'), { window });
  window.confirm = confirm;
  const navigator = { onLine: online };
  const id = {
    initialize(options) { calls.initialize++; calls.config = options; },
    renderButton(node, options) { calls.button = options; }
  };
  if (loaded) window.google = { accounts: { id } };
  const document = {
    createElement: () => ({ remove() { this.removed = true; } }),
    head: { append: script => scripts.push(script) }
  };
  Object.defineProperty(document, 'cookie', { get: forbidden, set: forbidden });
  vm.runInNewContext(source, {
    window, navigator, document, URL, AbortController,
    setTimeout(fn) { const key = {}; timers.set(key, fn); return key; },
    clearTimeout: key => timers.delete(key),
    localStorage: new Proxy({}, { get: forbidden }),
    sessionStorage: new Proxy({}, { get: forbidden }),
    indexedDB: new Proxy({}, { get: forbidden }),
    caches: new Proxy({}, { get: forbidden }),
    fetch: fetchImpl || forbidden, atob: forbidden,
    console: new Proxy({}, { get: forbidden })
  });
  function mount() {
    const elements = Object.fromEntries(['button', 'status', 'retry', 'clear', ...(temporary ? ['testWrite', 'testStatus'] : [])].map(key =>
      [key, { hidden: false, textContent: '', clientWidth: 260, replaceChildren() {} }]));
    const dispose = window.JarvisAuth.mount(elements);
    return { ...elements, dispose };
  }
  return { window, navigator, events, scripts, timers, calls, id, mount };
}

test('official popup callback receives opaque identity without validating or exposing it', async () => {
  const h = harness();
  const ui = h.mount();
  await settle();
  assert.equal(h.calls.config.ux_mode, 'popup');
  assert.equal(h.calls.config.auto_select, false);
  assert.equal(h.calls.button.text, 'continue_with');
  h.calls.button.click_listener();
  // Deliberately not a JWT: receiving a value is never equivalent to validation.
  h.calls.config.callback({ credential: 'opaque-test-value-not-a-real-token' });
  assert.match(ui.status.textContent, /Identidad recibida; falta configurar el backend/);
  assert.doesNotMatch(ui.status.textContent, /opaque-test-value/);
  assert.equal(ui.button.hidden, false);
  assert.deepEqual(Object.keys(h.window.JarvisAuth), ['mount']);
  ui.clear.onclick();
  assert.match(ui.status.textContent, /descartado/);
  h.calls.config.callback({ credential: 'late-test-value' });
  assert.match(ui.status.textContent, /descartado/);
});

test('cancelled attempts stay retryable; malformed responses never become identity', async () => {
  const h = harness();
  const ui = h.mount();
  await settle();
  h.calls.button.click_listener();
  assert.match(ui.status.textContent, /Si cierras la ventana/);
  assert.equal(ui.button.hidden, false);
  h.calls.config.callback({});
  assert.match(ui.status.textContent, /no devolvió/);
  h.calls.button.click_listener();
  h.calls.config.callback({ credential: '   ' });
  assert.match(ui.status.textContent, /no devolvió/);
});

test('demo disposal, offline and pagehide discard pending callbacks; GIS initializes once', async () => {
  const h = harness();
  let ui = h.mount();
  await settle();
  h.calls.button.click_listener();
  ui.dispose();
  h.calls.config.callback({ credential: 'late-test-value' });
  assert.doesNotMatch(ui.status.textContent, /Identidad recibida/);
  ui = h.mount();
  await settle();
  assert.equal(h.calls.initialize, 1);
  h.calls.button.click_listener();
  h.navigator.onLine = false;
  h.events.offline();
  h.calls.config.callback({ credential: 'late-test-value' });
  assert.match(ui.status.textContent, /Sin conexión/);
  h.navigator.onLine = true;
  h.events.online();
  await settle();
  h.calls.button.click_listener();
  h.events.pagehide();
  h.calls.config.callback({ credential: 'late-test-value' });
  assert.match(ui.status.textContent, /descartada al salir/);
  h.events.pageshow({ persisted: true });
  await settle();
  assert.equal(ui.button.hidden, false);
});

test('offline mount does not load GIS; script failure and timeout allow retry', async () => {
  const offline = harness({ loaded: false, online: false });
  const offlineUI = offline.mount();
  assert.equal(offline.scripts.length, 0);
  assert.match(offlineUI.status.textContent, /Sin conexión/);
  const h = harness({ loaded: false });
  const ui = h.mount();
  assert.equal(h.scripts[0].src, 'https://accounts.google.com/gsi/client?hl=es');
  h.scripts[0].onerror();
  await settle();
  assert.match(ui.status.textContent, /No se pudo cargar Google/);
  assert.equal(ui.retry.hidden, false);
  ui.retry.onclick();
  [...h.timers.values()][0]();
  await settle();
  assert.equal(ui.retry.hidden, false);
  ui.retry.onclick();
  h.window.google = { accounts: { id: h.id } };
  h.scripts.at(-1).onload();
  await settle();
  assert.equal(h.calls.initialize, 1);
  assert.equal(ui.button.hidden, false);
});

test('a late SDK load cannot alter the public demo after unmount', async () => {
  const h = harness({ loaded: false });
  const ui = h.mount();
  ui.dispose();
  h.window.google = { accounts: { id: h.id } };
  h.scripts[0].onload();
  await settle();
  assert.equal(h.calls.initialize, 0);
});

test('only a strict backend 200 authorizes; tokens use no-store bearer POST', async () => {
  const requests = [];
  const h = harness({ apiBaseUrl: 'http://127.0.0.1:8080', fetchImpl: async (url, options) => {
    requests.push(url);
    assert.equal(url, `http://127.0.0.1:8080${requests.length === 1 ? '/auth/me' : '/api/sheets/status'}`);
    assert.equal(options.method, requests.length === 1 ? 'POST' : 'GET');
    assert.equal(options.headers.Authorization, 'Bearer synthetic-test-value');
    assert.equal(options.cache, 'no-store');
    assert.equal(options.credentials, 'omit');
    assert.equal(options.redirect, 'error');
    assert.equal(options.body, undefined);
    return { status: 200, json: async () => requests.length === 1
      ? { authenticated: true, authorized: true } : { connected: true } };
  } });
  const ui = h.mount();
  await settle();
  h.calls.button.click_listener();
  await h.calls.config.callback({ credential: 'synthetic-test-value' });
  assert.match(ui.status.textContent, /usuario autorizado por el backend/);
  assert.doesNotMatch(ui.status.textContent, /synthetic-test-value/);
  assert.match(ui.status.textContent, /Google Sheets conectado\./);
  assert.equal(requests.length, 2);
  assert.equal(h.timers.size, 0);
});

test('configured frontend origins send identity to their intended backend', async () => {
  for (const [origin, endpoint] of [
    ['http://localhost:8000', 'http://127.0.0.1:8080/auth/me'],
    ['http://127.0.0.1:8000', 'http://127.0.0.1:8080/auth/me'],
    ['http://localhost:8001', 'http://127.0.0.1:8080/auth/me'],
    ['https://luigytc.github.io/JarvisLifeTracker/', 'https://jarvislifetracker-505633966366.northamerica-south1.run.app/auth/me'],
    ['https://luigytc.github.io/JarvisLifeTracker/index.html?apiBaseUrl=http://127.0.0.1:8080', 'https://jarvislifetracker-505633966366.northamerica-south1.run.app/auth/me'],
    ['http://luigytc.github.io', 'https://jarvislifetracker-505633966366.northamerica-south1.run.app/auth/me']
  ]) {
    let requests = 0;
    const h = harness({ origin, useConfig: true, fetchImpl: async (url, options) => {
      requests++;
      assert.equal(url, requests === 1 ? endpoint : new URL('/api/sheets/status', endpoint).href);
      assert.equal(options.method, requests === 1 ? 'POST' : 'GET');
      assert.equal(options.headers.Authorization, 'Bearer synthetic-test-value');
      assert.equal(options.cache, 'no-store');
      assert.equal(options.credentials, 'omit');
      assert.equal(options.redirect, 'error');
      return { status: 200, json: async () => requests === 1
        ? { authenticated: true, authorized: true } : { connected: true } };
    } });
    const ui = h.mount();
    await settle();
    h.calls.button.click_listener();
    await h.calls.config.callback({ credential: 'synthetic-test-value' });
    assert.equal(requests, 2);
    assert.match(ui.status.textContent, /Google Sheets conectado\./);
    assert.match(ui.status.textContent, /usuario autorizado por el backend/);
  }
});

test('unsupported frontend origins never send identity to a backend', async () => {
  for (const origin of ['https://example.test', 'http://localhost.example.test:8000',
    'https://luigytc.github.io.example.test', 'null']) {
    let requests = 0;
    const h = harness({ origin, useConfig: true, fetchImpl: async () => { requests++; } });
    const ui = h.mount();
    await settle();
    h.calls.button.click_listener();
    await h.calls.config.callback({ credential: 'synthetic-test-value' });
    assert.equal(requests, 0);
    assert.match(ui.status.textContent, /falta configurar el backend/);
  }
});

test('Pages rejects stale local and unexpected HTTPS backends before sending identity', async () => {
  for (const apiBaseUrl of ['http://127.0.0.1:8080', 'http://localhost:8080',
    'https://127.0.0.1:8080', 'https://api.example.test']) {
    let requests = 0;
    const h = harness({ origin: 'https://luigytc.github.io/JarvisLifeTracker/', apiBaseUrl,
      fetchImpl: async () => { requests++; } });
    const ui = h.mount();
    await settle();
    h.calls.button.click_listener();
    await h.calls.config.callback({ credential: 'synthetic-test-value' });
    assert.equal(requests, 0);
    assert.match(ui.status.textContent, /No se pudo confirmar/);
  }
});

test('401, 403, 503, network errors and unexpected responses never authorize', async () => {
  for (const response of [
    { status: 401 }, { status: 403 }, { status: 503 }, { status: 500 },
    { status: 200, json: async () => ({ authenticated: true, authorized: false }) },
    { status: 200, json: async () => ({ authenticated: true, authorized: true, extra: 'unexpected' }) },
    { status: 200, json: async () => { throw new Error('invalid JSON'); } }, null
  ]) {
    let requests = 0;
    const h = harness({ apiBaseUrl: 'http://127.0.0.1:8080', fetchImpl: async () => {
      requests++;
      if (!response) throw new Error('network');
      return response;
    } });
    const ui = h.mount();
    await settle();
    h.calls.button.click_listener();
    await h.calls.config.callback({ credential: 'synthetic-test-value' });
    assert.doesNotMatch(ui.status.textContent, /Identidad validada; usuario autorizado/);
    assert.equal(ui.button.hidden, false);
    assert.equal(requests, 1);
  }
});

test('late API success cannot authorize after discard, offline, pagehide or demo', async () => {
  for (const action of ['discard', 'offline', 'pagehide', 'demo']) {
    let finish;
    let signal;
    const h = harness({ apiBaseUrl: 'http://127.0.0.1:8080', fetchImpl: (_, options) => {
      signal = options.signal;
      return new Promise(resolve => { finish = resolve; });
    } });
    const ui = h.mount();
    await settle();
    h.calls.button.click_listener();
    const pending = h.calls.config.callback({ credential: 'synthetic-test-value' });
    if (action === 'discard') ui.clear.onclick();
    if (action === 'offline') { h.navigator.onLine = false; h.events.offline(); }
    if (action === 'pagehide') h.events.pagehide();
    if (action === 'demo') ui.dispose();
    assert.equal(signal.aborted, true);
    finish({ status: 200, json: async () => ({ authenticated: true, authorized: true }) });
    await pending;
    assert.doesNotMatch(ui.status.textContent, /Identidad validada; usuario autorizado/);
  }
});

test('insecure remote API or URL with credentials cannot receive identity', async () => {
  for (const url of ['http://api.example.test', 'https://user:password@example.test', 'https://example.test/?x=1']) {
    const h = harness({ apiBaseUrl: url });
    const ui = h.mount();
    await settle();
    h.calls.button.click_listener();
    await h.calls.config.callback({ credential: 'synthetic-test-value' });
    assert.match(ui.status.textContent, /No se pudo confirmar/);
  }
});

test('Sheets failures keep authorization and show only a generic message', async () => {
  for (const result of [null, { status: 401 }, { status: 403 }, { status: 503 },
    { status: 200, json: async () => ({ connected: false }) },
    { status: 200, json: async () => ({ connected: true, private: 'private-detail' }) },
    { status: 200, json: async () => { throw new Error('private-detail'); } }]) {
    const h = harness({ apiBaseUrl: 'https://api.example.test', fetchImpl: async url => {
      if (url.endsWith('/auth/me')) return { status: 200, json: async () => ({ authenticated: true, authorized: true }) };
      if (!result) throw new Error('private-detail');
      return result;
    } });
    const ui = h.mount();
    await settle();
    h.calls.button.click_listener();
    await h.calls.config.callback({ credential: 'synthetic-test-value' });
    assert.equal(ui.status.textContent, 'Identidad validada; usuario autorizado por el backend. No se pudo comprobar la conexión con Google Sheets.');
    assert.equal(ui.button.hidden, false);
    assert.equal(h.timers.size, 0);
  }
});

test('Sheets is not requested until the authorization body is validated', async () => {
  let finish;
  let requests = 0;
  const h = harness({ apiBaseUrl: 'https://api.example.test', fetchImpl: async () => {
    requests++;
    return { status: 200, json: () => new Promise(resolve => { finish = resolve; }) };
  } });
  const ui = h.mount();
  await settle();
  h.calls.button.click_listener();
  const pending = h.calls.config.callback({ credential: 'synthetic-test-value' });
  await settle();
  assert.equal(requests, 1);
  ui.dispose();
  finish({ authenticated: true, authorized: true });
  await pending;
  assert.equal(requests, 1);
});

test('late Sheets responses and JSON cannot update discarded, offline, exited or demo views', async () => {
  for (const phase of ['fetch', 'json']) {
    for (const action of ['discard', 'offline', 'pagehide', 'demo', 'new-attempt']) {
      let finish;
      let signal;
      const h = harness({ apiBaseUrl: 'https://api.example.test', fetchImpl: async (url, options) => {
        if (url.endsWith('/auth/me')) return { status: 200, json: async () => ({ authenticated: true, authorized: true }) };
        signal = options.signal;
        const delayed = () => new Promise(resolve => { finish = resolve; });
        return phase === 'fetch' ? delayed() : { status: 200, json: delayed };
      } });
      const ui = h.mount();
      await settle();
      h.calls.button.click_listener();
      const pending = h.calls.config.callback({ credential: 'synthetic-test-value' });
      await settle();
      if (action === 'discard') ui.clear.onclick();
      if (action === 'offline') { h.navigator.onLine = false; h.events.offline(); }
      if (action === 'pagehide') h.events.pagehide();
      if (action === 'demo') ui.dispose();
      if (action === 'new-attempt') h.calls.button.click_listener();
      const previous = ui.status.textContent;
      assert.equal(signal.aborted, true);
      finish(phase === 'fetch' ? { status: 200, json: async () => ({ connected: true }) } : { connected: true });
      await pending;
      assert.equal(ui.status.textContent, previous);
      assert.equal(h.timers.size, 0);
    }
  }
});

test('Sheets timeout aborts the request and permits a fresh login', async () => {
  let signal;
  const h = harness({ apiBaseUrl: 'https://api.example.test', fetchImpl: async (url, options) => {
    if (url.endsWith('/auth/me')) return { status: 200, json: async () => ({ authenticated: true, authorized: true }) };
    signal = options.signal;
    return new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('timeout'))));
  } });
  const ui = h.mount();
  await settle();
  h.calls.button.click_listener();
  const pending = h.calls.config.callback({ credential: 'synthetic-test-value' });
  await settle();
  assert.equal(h.timers.size, 1);
  [...h.timers.values()][0]();
  await pending;
  assert.equal(signal.aborted, true);
  assert.match(ui.status.textContent, /No se pudo comprobar la conexión con Google Sheets\./);
  assert.equal(ui.button.hidden, false);
  assert.equal(h.timers.size, 0);
});
