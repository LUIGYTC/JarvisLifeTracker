const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const base = 'https://luigytc.github.io/JarvisLifeTracker/';

function worker() {
  const handlers = {};
  const hits = [];
  const context = {
    URL, Request, Response, console,
    self: { location: { href: `${base}sw.js` },
      addEventListener: (name, handler) => { handlers[name] = handler; } },
    caches: { open: async () => ({ match: async key => {
      hits.push(key);
      return new Response('static shell');
    } }) },
    fetch: async () => { throw new Error('offline'); }
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'sw.js'), 'utf8'), context);
  function dispatch(url, options = {}) {
    const req = new Request(url, options);
    let response;
    handlers.fetch({ request: {
      url: req.url, method: req.method, headers: req.headers,
      cache: req.cache, mode: options.navigation ? 'navigate' : req.mode
    }, respondWith: value => { response = value; } });
    return response;
  }
  return { dispatch, hits };
}

test('static shell remains available offline under the Pages base, including entry queries', async () => {
  const { dispatch, hits } = worker();
  for (const entry of ['', '?prueba=offline', 'index.html?prueba=offline']) {
    assert.equal(await (await dispatch(base + entry, { navigation: true })).text(), 'static shell');
    assert.equal(hits.at(-1), base + 'index.html');
  }
  assert.equal(await (await dispatch(base + 'app.js')).text(), 'static shell');
});

test('API, other origins, unknown routes and mutations bypass the static cache', () => {
  const { dispatch, hits } = worker();
  for (const url of [base + 'api/turnos?from=2032-01-01&to=2032-01-31', base + 'api/gastos-tarjetas', base + 'api/dinero-libre', base + 'api/dinero-disponible', base + 'api/balance', base + 'api/dashboard', base + 'api/tarjetas-credito', base + 'api/tarjetas-credito/proximo-corte?tarjeta=Synthetic', base + 'api/tarjetas-credito/msi?tarjeta=Synthetic', base + 'api/tarjetas-credito/movimientos?tarjeta=Synthetic', base + 'auth/me', base + 'unknown',
    'https://api.example.test/auth/me', 'https://accounts.google.com/gsi/client',
    'https://accounts.google.com/gsi/client?hl=es',
    'https://luigytc.github.io/another-project/']) {
    assert.equal(dispatch(url), undefined);
    assert.equal(dispatch(url, { navigation: true }), undefined);
  }
  assert.equal(dispatch(base + 'index.html', { method: 'POST' }), undefined);
  assert.deepEqual(hits, []);
});

test('Authorization and no-store bypass even static assets and entry navigations', () => {
  const { dispatch, hits } = worker();
  for (const url of [base, base + 'index.html?x=1', base + 'app.js']) {
    for (const navigation of [false, true]) {
      assert.equal(dispatch(url, { navigation, headers: { Authorization: 'Bearer test-only' } }), undefined);
      assert.equal(dispatch(url, { navigation, cache: 'no-store' }), undefined);
    }
  }
  assert.deepEqual(hits, []);
});

test('update reloads configuration and removes the previous app cache on activation', async () => {
  const handlers = {};
  const oldCache = 'jarvislifetracker:/JarvisLifeTracker/:2.3.17';
  const unrelated = 'jarvislifetracker:/another-project/:2.3.1';
  const stored = new Map([[oldCache, new Map()], [unrelated, new Map()]]);
  let installedCache;
  let requests;
  let claimed = false;
  vm.runInNewContext(fs.readFileSync(path.join(root, 'sw.js'), 'utf8'), {
    URL, Request, Response, console,
    self: {
      location: { href: `${base}sw.js` },
      addEventListener: (name, handler) => { handlers[name] = handler; },
      clients: { claim: async () => { claimed = true; } }
    },
    caches: {
      keys: async () => [...stored.keys()],
      delete: async key => stored.delete(key),
      open: async key => {
        if (!stored.has(key)) stored.set(key, new Map());
        return {
          addAll: async entries => {
            installedCache = key;
            requests = entries;
            for (const request of entries) {
              const source = request.url === base + 'config.js'
                ? fs.readFileSync(path.join(root, 'config.js'), 'utf8') : 'static shell';
              stored.get(key).set(request.url, new Response(source));
            }
          },
          match: async url => stored.get(key).get(url)?.clone()
        };
      }
    }
  });
  let pending;
  handlers.install({ waitUntil: promise => { pending = promise; } });
  await pending;
  assert.notEqual(installedCache, oldCache);
  assert.equal(installedCache, 'jarvislifetracker:/JarvisLifeTracker/:2.3.20');
  assert.ok(requests.some(request => request.url === base + 'config.js'));
  assert.ok(requests.some(request => request.url === base + 'tarjetas-credito.js'));
  assert.ok(requests.some(request => request.url === base + 'gastos-tarjetas.js'));
  assert.ok(requests.some(request => request.url === base + 'dinero-disponible.js'));
  assert.ok(requests.some(request => request.url === base + 'dinero-libre.js'));
  assert.ok(requests.every(request => !new URL(request.url).pathname.includes('/api/')));
  assert.ok(requests.every(request => request.cache === 'reload'));
  handlers.activate({ waitUntil: promise => { pending = promise; } });
  await pending;
  assert.equal(stored.has(oldCache), false);
  assert.equal(stored.has(unrelated), true);
  assert.equal(claimed, true);
  let response;
  handlers.fetch({ request: new Request(base + 'config.js'), respondWith: value => { response = value; } });
  const window = { location: new URL(base) };
  vm.runInNewContext(await (await response).text(), { window });
  assert.equal(window.JarvisConfig.apiBaseUrl,
    'https://jarvislifetracker-505633966366.northamerica-south1.run.app');
});
