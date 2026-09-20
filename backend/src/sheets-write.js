import { GoogleAuth } from 'google-auth-library';
import { SPREADSHEET_ID, MOVIMIENTOS_RANGE } from './config.js';
import { movimientoRow } from './movimientos.js';

export function createMovementWriter({
  auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/spreadsheets'] }),
  fetchImpl = fetch, timeoutMs = 8000
} = {}) {
  return async movement => {
    const row = movimientoRow(movement);
    const controller = new AbortController();
    let timer;
    try {
      const operation = (async () => {
        const client = await auth.getClient();
        const headers = new Headers(await client.getRequestHeaders());
        headers.set('Content-Type', 'application/json');
        controller.signal.throwIfAborted();
        const url = new URL(`https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(MOVIMIENTOS_RANGE)}:append`);
        url.search = new URLSearchParams({ valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS',
          includeValuesInResponse: 'false', fields: 'updates(updatedRows,updatedColumns,updatedCells,updatedRange)' });
        // Native fetch: a write must never be automatically replayed by an auth/HTTP library.
        const response = await fetchImpl(url, { method: 'POST', headers,
          body: JSON.stringify({ majorDimension: 'ROWS', values: [row] }),
          signal: controller.signal, redirect: 'error', cache: 'no-store' });
        if (response.status !== 200) throw new Error('Write failed');
        const { updates } = await response.json();
        const range = /^'?Movimientos'?!A([1-9]\d*):I([1-9]\d*)$/.exec(updates?.updatedRange || '');
        if (updates?.updatedRows !== 1 || updates.updatedColumns !== 9 || updates.updatedCells !== 9 ||
            !range || range[1] !== range[2]) throw new Error('Unexpected write result');
        return true;
      })();
      return await Promise.race([operation, new Promise((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new Error('Write timeout')); }, timeoutMs);
      })]);
    } catch {
      // Do not expose provider errors, credentials, financial values or request URLs.
      throw new Error('Movement unavailable');
    } finally { clearTimeout(timer); }
  };
}
