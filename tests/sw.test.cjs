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
  for (const url of [base + 'api/balance', base + 'auth/me', base + 'unknown',
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
