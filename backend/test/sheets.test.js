import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSheetsCheck } from '../src/sheets.js';
import { SPREADSHEET_ID } from '../src/config.js';

test('Sheets uses an ADC client for a fixed read-only metadata request', async () => {
  let calls = 0;
  const check = createSheetsCheck({ auth: { getClient: async () => ({ request: async options => {
    calls++;
    assert.equal(options.url, `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}`);
    assert.equal(options.method, 'GET');
    assert.deepEqual(options.params, { fields: 'spreadsheetId', includeGridData: false });
    assert.equal(options.data, undefined);
    assert.equal(options.headers, undefined);
    assert.equal(options.retry, false);
    assert.equal(options.maxRedirects, 0);
    assert.equal(options.signal.aborted, false);
    return { status: 200, data: { spreadsheetId: SPREADSHEET_ID, unexpectedPrivateData: 'never returned' } };
  } }) } });
  assert.equal(await check(), true);
  assert.equal(calls, 1);
});

test('Sheets sanitizes missing ADC, permissions, quota, network and malformed responses', async () => {
  const auths = [{ getClient: async () => { throw new Error('private ADC detail'); } }];
  for (const code of [401, 403, 404, 429, 500, 'ENOTFOUND']) {
    auths.push({ getClient: async () => ({ request: async () => {
      throw Object.assign(new Error('private provider detail'), { code, response: { data: 'private cells' } });
    } }) });
  }
  for (const response of [{ status: 200, data: {} }, { status: 200, data: { spreadsheetId: 'other' } },
    { status: 503, data: { spreadsheetId: SPREADSHEET_ID } }]) {
    auths.push({ getClient: async () => ({ request: async () => response }) });
  }
  for (const auth of auths) {
    await assert.rejects(createSheetsCheck({ auth })(), error => {
      assert.equal(error.message, 'Sheets unavailable');
      assert.equal(error.cause, undefined);
      assert.equal(error.response, undefined);
      return true;
    });
  }
});

test('Sheets timeout aborts requests and bounds slow ADC discovery', async () => {
  let signal;
  await assert.rejects(createSheetsCheck({ timeoutMs: 10, auth: {
    getClient: async () => ({ request: options => { signal = options.signal; return new Promise(() => {}); } })
  } })(), /Sheets unavailable/);
  assert.equal(signal.aborted, true);
  let finishDiscovery;
  let requests = 0;
  const check = createSheetsCheck({ timeoutMs: 10, auth: {
    getClient: () => new Promise(resolve => { finishDiscovery = resolve; })
  } });
  await assert.rejects(check(), /Sheets unavailable/);
  finishDiscovery({ request: async () => { requests++; } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests, 0);
});
