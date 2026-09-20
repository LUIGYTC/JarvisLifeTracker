import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../src/app.js';
import { readConfig } from '../src/config.js';

async function setup(t, options = {}) {
  const server = createApp({ authorizedSub: 'test-owner', verify: async token => {
    if (token === 'test.owner.signature') return 'test-owner';
    if (token === 'test.other.signature') return 'test-other';
    throw new Error('Test verifier rejection');
  }, ...options });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  return (route, init) => fetch(origin + route, init);
}

test('health reveals only liveness, with no-store', async t => {
  const request = await setup(t);
  const res = await request('/health');
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  assert.equal(res.headers.get('cache-control'), 'no-store');
});

test('missing, invalid, unauthorized and authorized tokens', async t => {
  const request = await setup(t);
  for (const [token, code, body] of [
    ['', 401, { error: 'invalid_identity' }],
    ['invalid', 401, { error: 'invalid_identity' }],
    ['test.invalid.signature', 401, { error: 'invalid_identity' }],
    ['test.other.signature', 403, { error: 'not_authorized' }],
    ['test.owner.signature', 200, { authenticated: true, authorized: true }]
  ]) {
    const res = await request('/auth/me', { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {} });
    assert.equal(res.status, code);
    assert.deepEqual(await res.json(), body);
    assert.equal(res.headers.get('cache-control'), 'no-store');
  }
});

test('unconfigured account never authorizes a valid identity', async t => {
  const request = await setup(t, { authorizedSub: '' });
  const res = await request('/auth/me', { method: 'POST', headers: { Authorization: 'Bearer test.owner.signature' } });
  assert.equal(res.status, 503);
});

test('CORS explicitly supports both origins and Authorization preflight', async t => {
  const request = await setup(t);
  for (const origin of ['http://localhost:8000', 'https://luigytc.github.io']) {
    const res = await request('/auth/me', { method: 'OPTIONS', headers: {
      Origin: origin, 'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'authorization,content-type'
    } });
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('access-control-allow-origin'), origin);
    assert.match(res.headers.get('access-control-allow-headers'), /Authorization/);
    assert.equal(res.headers.get('access-control-allow-credentials'), null);
    const actual = await request('/auth/me', { method: 'POST', headers: { Origin: origin } });
    assert.equal(actual.status, 401);
    assert.equal(actual.headers.get('access-control-allow-origin'), origin);
  }
});

test('disallowed origin, method and preflight headers are rejected', async t => {
  let verified = false;
  const request = await setup(t, { verify: () => { verified = true; } });
  for (const origin of ['https://evil.example', 'http://localhost:8001', 'null']) {
    const res = await request('/auth/me', { method: 'POST', headers: { Origin: origin, Authorization: 'Bearer test.owner.signature' } });
    assert.equal(res.status, 403);
    assert.equal(res.headers.get('access-control-allow-origin'), null);
  }
  assert.equal(verified, false);
  assert.equal((await request('/auth/me')).status, 405);
  assert.equal((await request('/auth/me?token=test')).status, 404);
  for (const [method, headers] of [['GET', 'authorization'], ['POST', 'x-arbitrary']]) {
    assert.equal((await request('/auth/me', { method: 'OPTIONS', headers: {
      Origin: 'http://localhost:8000', 'Access-Control-Request-Method': method,
      'Access-Control-Request-Headers': headers
    } })).status, 403);
  }
});

test('verification timeout and unexpected verification failure remain closed', async t => {
  const request = await setup(t, { verificationTimeoutMs: 10, verify: () => new Promise(() => {}) });
  assert.equal((await request('/auth/me', { method: 'POST', headers: { Authorization: 'Bearer test.owner.signature' } })).status, 401);
});

test('configuration supports Cloud Run and loopback local defaults', () => {
  assert.equal(readConfig({}).host, '127.0.0.1');
  assert.equal(readConfig({ PORT: '9090', NODE_ENV: 'production', HOST: 'localhost' }).host, '0.0.0.0');
  assert.equal(readConfig({ PORT: '9090' }).port, 9090);
  assert.throws(() => readConfig({ PORT: 'bad' }));
});
