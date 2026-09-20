const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../auth.js'), 'utf8');
const settle = () => new Promise(resolve => setImmediate(resolve));

function harness({ online = true, loaded = true, apiBaseUrl = '', origin = 'http://localhost:8000', useConfig = false, fetchImpl } = {}) {
  const events = {};
  const scripts = [];
  const timers = new Map();
  const calls = { initialize: 0 };
  const forbidden = () => { throw new Error('Unexpected storage, logging, decoding or API access'); };
  const window = { location: { origin }, JarvisConfig: { apiBaseUrl }, addEventListener: (type, listener) => { events[type] = listener; } };
  if (useConfig) vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../config.js'), 'utf8'), { window });
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
    const elements = Object.fromEntries(['button', 'status', 'retry', 'clear'].map(key =>
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
  const h = harness({ apiBaseUrl: 'http://127.0.0.1:8080', fetchImpl: async (url, options) => {
    assert.equal(url, 'http://127.0.0.1:8080/auth/me');
    assert.equal(options.method, 'POST');
    assert.equal(options.headers.Authorization, 'Bearer synthetic-test-value');
    assert.equal(options.cache, 'no-store');
    assert.equal(options.credentials, 'omit');
    assert.equal(options.redirect, 'error');
    assert.equal(options.body, undefined);
    return { status: 200, json: async () => ({ authenticated: true, authorized: true }) };
  } });
  const ui = h.mount();
  await settle();
  h.calls.button.click_listener();
  await h.calls.config.callback({ credential: 'synthetic-test-value' });
  assert.match(ui.status.textContent, /usuario autorizado por el backend/);
  assert.doesNotMatch(ui.status.textContent, /synthetic-test-value/);
});

test('configured frontend origins send identity to their intended backend', async () => {
  for (const [origin, endpoint] of [
    ['http://localhost:8000', 'http://127.0.0.1:8080/auth/me'],
    ['https://luigytc.github.io', 'https://jarvislifetracker-505633966366.northamerica-south1.run.app/auth/me']
  ]) {
    let requests = 0;
    const h = harness({ origin, useConfig: true, fetchImpl: async (url, options) => {
      requests++;
      assert.equal(url, endpoint);
      assert.equal(options.method, 'POST');
      assert.equal(options.headers.Authorization, 'Bearer synthetic-test-value');
      assert.equal(options.cache, 'no-store');
      assert.equal(options.credentials, 'omit');
      assert.equal(options.redirect, 'error');
      return { status: 200, json: async () => ({ authenticated: true, authorized: true }) };
    } });
    const ui = h.mount();
    await settle();
    h.calls.button.click_listener();
    await h.calls.config.callback({ credential: 'synthetic-test-value' });
    assert.equal(requests, 1);
    assert.match(ui.status.textContent, /usuario autorizado por el backend/);
  }
});

test('unsupported frontend origins never send identity to a backend', async () => {
  for (const origin of ['http://127.0.0.1:8000', 'http://localhost:8001',
    'http://luigytc.github.io', 'https://luigytc.github.io.example.test', 'null']) {
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

test('401, 403, 503, network errors and unexpected responses never authorize', async () => {
  for (const response of [
    { status: 401 }, { status: 403 }, { status: 503 }, { status: 500 },
    { status: 200, json: async () => ({ authenticated: true, authorized: false }) },
    { status: 200, json: async () => ({ authenticated: true, authorized: true, extra: 'unexpected' }) },
    { status: 200, json: async () => { throw new Error('invalid JSON'); } }, null
  ]) {
    const h = harness({ apiBaseUrl: 'http://127.0.0.1:8080', fetchImpl: async () => {
      if (!response) throw new Error('network');
      return response;
    } });
    const ui = h.mount();
    await settle();
    h.calls.button.click_listener();
    await h.calls.config.callback({ credential: 'synthetic-test-value' });
    assert.doesNotMatch(ui.status.textContent, /Identidad validada; usuario autorizado/);
    assert.equal(ui.button.hidden, false);
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
