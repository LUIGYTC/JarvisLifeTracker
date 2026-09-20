import { OAuth2Client } from 'google-auth-library';
import { GOOGLE_CLIENT_ID } from './config.js';

export function createVerifier(client = new OAuth2Client()) {
  return async token => {
    const ticket = await client.verifyIdToken({ idToken: token, audience: GOOGLE_CLIENT_ID });
    const payload = ticket.getPayload();
    // Google verifies the signature using rotating public keys. These strict
    // claim checks also reject expiration within the library's clock tolerance.
    if (!payload || payload.aud !== GOOGLE_CLIENT_ID ||
        !['accounts.google.com', 'https://accounts.google.com'].includes(payload.iss) ||
        !Number.isFinite(payload.exp) || payload.exp <= Date.now() / 1000 ||
        typeof payload.sub !== 'string' || !payload.sub.trim()) {
      throw new Error('Invalid identity');
    }
    return payload.sub;
  };
}
