import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import { assertBootstrapAllowed, createBootstrapServer } from '../tools/bootstrap.js';

test('bootstrap requires local development, explicit flag and interactive terminal', () => {
  assert.doesNotThrow(() => assertBootstrapAllowed({ NODE_ENV: 'development' }, ['--discover-sub'], true));
  for (const env of [{}, { NODE_ENV: 'production' },
    { NODE_ENV: 'development', K_SERVICE: 'test' }, { NODE_ENV: 'development', K_REVISION: 'test' },
    { NODE_ENV: 'development', CLOUD_RUN_JOB: 'test' }, { NODE_ENV: 'development', CI: 'true' }]) {
    assert.throws(() => assertBootstrapAllowed(env, ['--discover-sub'], true));
  }
  assert.throws(() => assertBootstrapAllowed({ NODE_ENV: 'development' }, [], true));
  assert.throws(() => assertBootstrapAllowed({ NODE_ENV: 'development' }, ['--discover-sub'], false));
  const dockerfile = readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8');
  assert.doesNotMatch(dockerfile, /COPY\s+\.\s|COPY.*tools/);
});

test('bootstrap checks origin and nonce, verifies identity, and never returns sub', async t => {
  let received;
  const { server, route } = createBootstrapServer({ verify: async () => 'synthetic-sub', onVerified: sub => { received = sub; } });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const url = `http://127.0.0.1:${server.address().port}${route}`;
  const headers = { Host: 'localhost:8000', Origin: 'http://localhost:8000', Authorization: 'Bearer test.owner.signature' };
  const post = headers => new Promise((resolve, reject) => {
    const req = http.request(url, { method: 'POST', headers }, res => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
    });
    req.on('error', reject);
    req.end();
  });
  assert.equal((await post(headers)).status, 403);
  const res = await post({ ...headers, 'X-Bootstrap-Nonce': route.slice('/discover-'.length) });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true });
  assert.equal(received, 'synthetic-sub');
});
