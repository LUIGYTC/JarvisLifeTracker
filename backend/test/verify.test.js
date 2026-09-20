import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createSign } from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import { createVerifier } from '../src/verify.js';
import { GOOGLE_CLIENT_ID } from '../src/config.js';

// Ephemeral test keys and JWTs never leave this process or touch disk/logs.
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const client = new OAuth2Client();
client.getFederatedSignonCertsAsync = async () => ({
  certs: { 'test-key': publicKey.export({ type: 'spki', format: 'pem' }) }, format: 'PEM'
});
const verify = createVerifier(client);
function jwt(overrides = {}) {
  const now = Math.floor(Date.now() / 1000);
  const claims = { aud: GOOGLE_CLIENT_ID, iss: 'https://accounts.google.com', sub: 'test-owner', iat: now - 10, exp: now + 600, ...overrides };
  const data = [ { alg: 'RS256', kid: 'test-key' }, claims ]
    .map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.');
  const signature = createSign('RSA-SHA256').update(data).sign(privateKey, 'base64url');
  return `${data}.${signature}`;
}

test('official library verifies a synthetic signature and extracts only sub', async () => {
  assert.equal(await verify(jwt()), 'test-owner');
});

test('signature, audience, issuer, expiration and subject are enforced', async () => {
  for (const changes of [
    { aud: 'wrong-client' }, { iss: 'https://evil.example' },
    { exp: Math.floor(Date.now() / 1000) - 1 }, { exp: 0 }, { sub: '' }, { sub: 123 }
  ]) await assert.rejects(verify(jwt(changes)), () => true);
  const valid = jwt();
  const parts = valid.split('.');
  parts[2] = (parts[2][0] === 'A' ? 'B' : 'A') + parts[2].slice(1);
  await assert.rejects(verify(parts.join('.')), () => true);
  await assert.rejects(verify('invalid'), () => true);
});
