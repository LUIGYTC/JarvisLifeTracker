const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');

test('frontend server serves public assets but never backend, env or dependencies', async t => {
  const child = spawn(process.execPath, [path.join(__dirname, '../scripts/serve.cjs')], {
    env: { ...process.env, PORT: '0' }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']
  });
  t.after(() => child.kill());
  const url = await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', code => reject(new Error(`Server exited ${code}`)));
    let output = '';
    child.stdout.on('data', chunk => {
      output += chunk;
      const match = output.match(/http:\/\/localhost:\d+/);
      if (match) resolve(match[0]);
    });
  });
  for (const route of ['/', '/auth.js', '/dashboard.js', '/navigation.js', '/rutinas.js', '/descanso.js', '/config.js', '/sw.js', '/manifest.webmanifest']) {
    assert.equal((await fetch(url + route)).status, 200);
  }
  for (const route of ['/backend/.env', '/backend/src/server.js', '/backend/package.json',
    '/backend/node_modules/google-auth-library/package.json', '/.git/config', '/README.md']) {
    assert.equal((await fetch(url + route)).status, 403);
  }
});
