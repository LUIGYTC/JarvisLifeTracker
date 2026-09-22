const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../auth.js'), 'utf8');
const settle = () => new Promise(resolve => setImmediate(resolve));

test('credit reader is published only after authorization and reads the fixed API without persistence', async () => {
  let reader, status = 200;
  const paths = [];
  const h = harness({ apiBaseUrl: 'https://api.example.test', onTarjetasReader: value => { reader = value; }, fetchImpl: async (url, options) => {
    const path = new URL(url).pathname; paths.push(path);
    assert.equal(options.headers.Authorization, 'Bearer synthetic-test-value');
    assert.equal(options.credentials, 'omit'); assert.equal(options.cache, 'no-store'); assert.equal(options.redirect, 'error');
    return { status: path === '/api/tarjetas-credito' ? status : 200, json: async () => path === '/auth/me'
      ? { authenticated: true, authorized: true } : path === '/api/sheets/status' ? { connected: true } : { tarjetas: [] } };
  } });
  const ui = h.mount(); await settle(); assert.equal(reader, undefined);
  h.calls.button.click_listener(); await h.calls.config.callback({ credential: 'synthetic-test-value' });
  assert.deepEqual(paths, ['/auth/me', '/api/sheets/status']);
  assert.deepEqual(await reader(), { tarjetas: [] });
  assert.equal(paths.at(-1), '/api/tarjetas-credito');
  status = 403; await assert.rejects(reader());
  const count = paths.length; await assert.rejects(reader()); assert.equal(paths.length, count);
  assert.match(ui.status.textContent, /Vuelve a iniciar/);
});

test('credit reader is never available after denied identity or failed Sheets connectivity', async () => {
  for (const failure of ['/auth/me', '/api/sheets/status']) {
    let reader;
    const h = harness({ apiBaseUrl: 'https://api.example.test', onTarjetasReader: value => { reader = value; }, fetchImpl: async url => ({
      status: url.endsWith(failure) ? 403 : 200,
      json: async () => ({ authenticated: true, authorized: true })
    }) });
    h.mount(); await settle(); h.calls.button.click_listener();
    await h.calls.config.callback({ credential: 'synthetic-test-value' });
    assert.equal(reader, undefined);
  }
});

test('credit reads abort on discard, offline, pagehide, disposal, caller cancellation and timeout', async () => {
  for (const action of ['discard', 'offline', 'pagehide', 'dispose', 'caller', 'timeout']) {
    let reader, signal, calls = 0;
    const h = harness({ apiBaseUrl: 'https://api.example.test', onTarjetasReader: value => { reader = value; }, fetchImpl: async (url, options) => {
      if (url.endsWith('/auth/me')) return { status: 200, json: async () => ({ authenticated: true, authorized: true }) };
      if (url.endsWith('/api/sheets/status')) return { status: 200, json: async () => ({ connected: true }) };
      calls++; signal = options.signal;
      return new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))));
    } });
    const ui = h.mount(); await settle(); h.calls.button.click_listener();
    await h.calls.config.callback({ credential: 'synthetic-test-value' });
    const controller = new AbortController();
    const pending = assert.rejects(reader(controller.signal));
    if (action === 'discard') ui.clear.onclick();
    if (action === 'offline') h.events.offline();
    if (action === 'pagehide') h.events.pagehide();
    if (action === 'dispose') ui.dispose();
    if (action === 'caller') controller.abort();
    if (action === 'timeout') [...h.timers.values()][0]();
    await pending; assert.equal(signal.aborted, true); assert.equal(calls, 1);
  }
});

test('late credit responses or JSON cannot return private data after logout', async () => {
  for (const stage of ['fetch', 'json']) {
    let reader, resolveLate;
    const h = harness({ apiBaseUrl: 'https://api.example.test', onTarjetasReader: value => { reader = value; }, fetchImpl: async url => {
      if (url.endsWith('/auth/me')) return { status: 200, json: async () => ({ authenticated: true, authorized: true }) };
      if (url.endsWith('/api/sheets/status')) return { status: 200, json: async () => ({ connected: true }) };
      if (stage === 'fetch') return new Promise(resolve => { resolveLate = resolve; });
      return { status: 200, json: () => new Promise(resolve => { resolveLate = resolve; }) };
    } });
    const ui = h.mount(); await settle(); h.calls.button.click_listener();
    await h.calls.config.callback({ credential: 'synthetic-test-value' });
    const pending = assert.rejects(reader()); await settle(); ui.dispose();
    resolveLate(stage === 'fetch' ? { status: 200, json: async () => ({ tarjetas: [] }) } : { tarjetas: [] });
    await pending;
  }
});

test('card movement reader encodes exact selection and shares authorized no-store lifecycle', async () => {
  let reader, responseStatus = 200;
  const requests = [];
  const h = harness({ apiBaseUrl: 'https://api.example.test', onTarjetaMovimientosReader: value => { reader = value; }, fetchImpl: async (url, options) => {
    if (url.endsWith('/auth/me')) return { status: 200, json: async () => ({ authenticated: true, authorized: true }) };
    if (url.endsWith('/api/sheets/status')) return { status: 200, json: async () => ({ connected: true }) };
    requests.push(url);
    assert.equal(options.headers.Authorization, 'Bearer synthetic-test-value');
    assert.equal(options.credentials, 'omit'); assert.equal(options.cache, 'no-store'); assert.equal(options.redirect, 'error');
    assert.equal(new URL(url).pathname, '/api/tarjetas-credito/movimientos');
    assert.equal(new URL(url).searchParams.get('tarjeta'), 'Sintética + & Crédito');
    return { status: responseStatus, json: async () => ({ tarjeta: 'Sintética + & Crédito', movimientos: [] }) };
  } });
  h.mount(); await settle(); assert.equal(reader, undefined);
  h.calls.button.click_listener(); await h.calls.config.callback({ credential: 'synthetic-test-value' });
  assert.equal(requests.length, 0);
  await reader('Sintética + & Crédito'); responseStatus = 401;
  await assert.rejects(reader('Sintética + & Crédito'));
  await assert.rejects(reader('Sintética + & Crédito')); assert.equal(requests.length, 2);
});

test('card movement reads are aborted and late JSON rejected on session exit or caller cancellation', async () => {
  for (const action of ['discard', 'dispose', 'offline', 'pagehide', 'caller', 'timeout']) {
    let reader, signal, resolveLate;
    const h = harness({ apiBaseUrl: 'https://api.example.test', onTarjetaMovimientosReader: value => { reader = value; }, fetchImpl: async (url, options) => {
      if (url.endsWith('/auth/me')) return { status: 200, json: async () => ({ authenticated: true, authorized: true }) };
      if (url.endsWith('/api/sheets/status')) return { status: 200, json: async () => ({ connected: true }) };
      signal = options.signal;
      return { status: 200, json: () => new Promise(resolve => { resolveLate = resolve; }) };
    } });
    const ui = h.mount(); await settle(); h.calls.button.click_listener(); await h.calls.config.callback({ credential: 'synthetic-test-value' });
    const controller = new AbortController();
    const pending = assert.rejects(reader('Synthetic', controller.signal)); await settle();
    if (action === 'discard') ui.clear.onclick();
    if (action === 'dispose') ui.dispose();
    if (action === 'offline') h.events.offline();
    if (action === 'pagehide') h.events.pagehide();
    if (action === 'caller') controller.abort();
    if (action === 'timeout') [...h.timers.values()][0]();
    assert.equal(signal.aborted, true); resolveLate({ tarjeta: 'Synthetic', movimientos: [] }); await pending;
  }
});

test('turnos reader is authorized only after login, retains token in memory and clears on rejection', async () => {
  let reader, status = 200;
  const paths = [];
  const h = harness({ apiBaseUrl: 'https://api.example.test', onTurnosReader: value => { reader = value; }, fetchImpl: async (url, options) => {
    const path = new URL(url).pathname; paths.push(path);
    assert.equal(options.headers.Authorization, 'Bearer synthetic-test-value');
    assert.equal(options.credentials, 'omit'); assert.equal(options.cache, 'no-store');
    assert.equal(options.redirect, 'error');
    return { status: path === '/api/turnos' ? status : 200, json: async () => path === '/auth/me'
      ? { authenticated: true, authorized: true } : path === '/api/sheets/status' ? { connected: true } : { turnos: [] } };
  } });
  const ui = h.mount(); await settle(); assert.equal(reader, undefined);
  h.calls.button.click_listener(); await h.calls.config.callback({ credential: 'synthetic-test-value' });
  assert.deepEqual(paths, ['/auth/me', '/api/sheets/status']);
  assert.deepEqual(await reader('2032-01-01', '2032-01-31'), { turnos: [] });
  status = 401;
  await assert.rejects(reader('2032-01-01', '2032-01-31'));
  const count = paths.length;
  await assert.rejects(reader('2032-01-01', '2032-01-31'));
  assert.equal(paths.length, count); assert.match(ui.status.textContent, /Vuelve a iniciar/);
  assert.equal(ui.button.hidden, false);
});

test('turnos pending reads abort on discard, demo, offline, pagehide and timeout without retry', async () => {
  for (const action of ['discard', 'demo', 'offline', 'pagehide', 'timeout']) {
    let reader, signal, requests = 0;
    const h = harness({ apiBaseUrl: 'https://api.example.test', onTurnosReader: value => { reader = value; }, fetchImpl: async (url, options) => {
      if (url.endsWith('/auth/me')) return { status: 200, json: async () => ({ authenticated: true, authorized: true }) };
      if (url.endsWith('/api/sheets/status')) return { status: 200, json: async () => ({ connected: true }) };
      requests++; signal = options.signal;
      return new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))));
    } });
    const ui = h.mount(); await settle(); h.calls.button.click_listener();
    await h.calls.config.callback({ credential: 'synthetic-test-value' });
    const pending = assert.rejects(reader('2032-01-01', '2032-01-31'));
    if (action === 'discard') ui.clear.onclick();
    if (action === 'demo') ui.dispose();
    if (action === 'offline') h.events.offline();
    if (action === 'pagehide') h.events.pagehide();
    if (action === 'timeout') [...h.timers.values()][0]();
    await pending; assert.equal(signal.aborted, true); assert.equal(requests, 1);
    if (action !== 'timeout') await assert.rejects(reader('2032-01-01', '2032-01-31'));
    assert.equal(requests, 1);
  }
});

test('temporary write UI and fixed payload are absent from frontend assets', () => {
  const appSource = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
  for (const text of [source, appSource]) {
    assert.doesNotMatch(text, /register-test|Registrar prueba|PRUEBA CONTROLADA|testAttempted|testWrite|window\.confirm|\/api\/movimientos/);
  }
});

function harness({ online = true, loaded = true, apiBaseUrl = '', origin = 'http://localhost:8000', useConfig = false, fetchImpl, onDashboard, onTurnosReader, onTarjetasReader, onTarjetaMovimientosReader } = {}) {
  const events = {};
  const scripts = [];
  const timers = new Map();
  const calls = { initialize: 0 };
  const forbidden = () => { throw new Error('Unexpected storage, logging, decoding or API access'); };
  const window = { location: origin === 'null' ? new URL('file:///index.html') : new URL(origin), JarvisConfig: { apiBaseUrl }, addEventListener: (type, listener) => { events[type] = listener; } };
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
    window, navigator, document, URL, URLSearchParams, AbortController,
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
    const dispose = window.JarvisAuth.mount({ ...elements, onDashboard, onTurnosReader, onTarjetasReader, onTarjetaMovimientosReader });
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

test('dashboard loads only after authorization and connected Sheets with the same in-memory token', async () => {
  const requests = [], events = [];
  const data = { summary: { movimientos: 0 } };
  const h = harness({ apiBaseUrl: 'https://api.example.test', onDashboard: (...args) => events.push(args), fetchImpl: async (url, options) => {
    requests.push(url);
    assert.equal(options.headers.Authorization, 'Bearer synthetic-test-value');
    assert.equal(options.cache, 'no-store'); assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'error');
    return { status: 200, json: async () => url.endsWith('/auth/me') ? { authenticated: true, authorized: true }
      : url.endsWith('/api/sheets/status') ? { connected: true } : data };
  } });
  const ui = h.mount(); await settle(); h.calls.button.click_listener();
  await h.calls.config.callback({ credential: 'synthetic-test-value' });
  assert.deepEqual(requests.map(url => new URL(url).pathname), ['/auth/me', '/api/sheets/status', '/api/dashboard']);
  assert.deepEqual(events.slice(-2), [['loading'], ['loaded', data]]);
  h.events.pagehide(); assert.deepEqual(events.at(-1), ['reset']);
  assert.equal(h.timers.size, 0);
});

test('dashboard errors stay generic and late reads cannot restore discarded data', async () => {
  for (const mode of ['error', 'discard', 'demo', 'offline', 'pagehide']) {
    const events = []; let finish; let signal;
    const h = harness({ apiBaseUrl: 'https://api.example.test', onDashboard: state => events.push(state), fetchImpl: async (url, options) => {
      if (url.endsWith('/auth/me')) return { status: 200, json: async () => ({ authenticated: true, authorized: true }) };
      if (url.endsWith('/api/sheets/status')) return { status: 200, json: async () => ({ connected: true }) };
      signal = options.signal;
      if (mode === 'error') throw new Error('private');
      return new Promise(resolve => { finish = resolve; });
    } });
    const ui = h.mount(); await settle(); h.calls.button.click_listener();
    const pending = h.calls.config.callback({ credential: 'synthetic-test-value' });
    await settle();
    if (mode !== 'error') {
      if (mode === 'discard') ui.clear.onclick();
      if (mode === 'demo') ui.dispose();
      if (mode === 'offline') { h.navigator.onLine = false; h.events.offline(); }
      if (mode === 'pagehide') h.events.pagehide();
      assert.equal(signal.aborted, true);
      finish({ status: 200, json: async () => ({ private: 'not displayed' }) });
    }
    await pending;
    assert.equal(events.includes('loaded'), false);
    assert.equal(events.at(-1), mode === 'error' ? 'error' : 'reset');
  }
});

test('failed authorization or Sheets connectivity never requests dashboard', async () => {
  for (const failAt of ['/auth/me', '/api/sheets/status']) {
    const paths = [];
    const h = harness({ apiBaseUrl: 'https://api.example.test', onDashboard: () => {}, fetchImpl: async url => {
      const pathname = new URL(url).pathname; paths.push(pathname);
      return pathname === failAt ? { status: 403 } : { status: 200, json: async () => ({ authenticated: true, authorized: true }) };
    } });
    const ui = h.mount(); await settle(); h.calls.button.click_listener();
    await h.calls.config.callback({ credential: 'synthetic-test-value' });
    assert.equal(paths.includes('/api/dashboard'), false);
  }
});
