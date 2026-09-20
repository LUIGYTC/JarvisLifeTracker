import { GoogleAuth } from 'google-auth-library';
import { SPREADSHEET_ID, MOVIMIENTOS_RANGE } from './config.js';
import { movimientoRow } from './movimientos.js';

export function createMovementWriter({
  auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/spreadsheets'] }),
  fetchImpl = fetch, timeoutMs = 20000
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
        const base = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}`;
        async function call(path, method = 'GET', body) {
          controller.signal.throwIfAborted();
          const result = await fetchImpl(new URL(base + path), { method, headers,
            ...(body ? { body: JSON.stringify(body) } : {}),
            signal: controller.signal, redirect: 'error', cache: 'no-store' });
          if (result.status !== 200) throw new Error('Sheets unavailable');
          return result.json();
        }
        const properties = await call('?fields=sheets.properties(title)');
        if (!Array.isArray(properties.sheets)) throw new Error('Invalid metadata');
        if (!properties.sheets.some(sheet => sheet.properties?.title === 'Operaciones')) {
          // Creation is not retried. A racing creator may succeed; this request
          // fails closed and a later client request can discover that sheet.
          await call(':batchUpdate', 'POST', { requests: [{ addSheet: { properties: {
            title: 'Operaciones', hidden: true, gridProperties: { columnCount: 3 }
          } } }] });
        }
        const operationId = movement.operationId.toLowerCase();
        const operationsPath = `/values/${encodeURIComponent("'Operaciones'!A:C")}`;
        async function findOperation() {
          const data = await call(operationsPath);
          const rows = data.values ?? [];
          if (!Array.isArray(rows)) throw new Error('Invalid ledger');
          const index = rows.findIndex(row => typeof row[0] === 'string' && row[0].toLowerCase() === operationId);
          return index < 0 ? null : { row: index + 1, state: rows[index][2] };
        }
        function existingResult(existing) {
          if (existing.state === 'registered') return 'duplicate';
          throw Object.assign(new Error('Operation pending'), { code: 'OPERATION_PENDING' });
        }
        const existing = await findOperation();
        if (existing) return existingResult(existing);
        const reservation = await call(operationsPath + ':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS&includeValuesInResponse=false', 'POST', {
          majorDimension: 'ROWS', values: [[operationId, new Date().toISOString(), 'pending']]
        });
        const reserved = /^'?Operaciones'?!A([1-9]\d*):C\1$/.exec(reservation.updates?.updatedRange || '');
        if (!reserved || reservation.updates.updatedRows !== 1) throw new Error('Invalid reservation');
        // Competing append reservations have different row numbers. Only the
        // first visible reservation may write. No pending reservation expires.
        const first = await findOperation();
        if (!first) throw new Error('Missing reservation');
        if (first.row !== Number(reserved[1]) || first.state !== 'pending') return existingResult(first);
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
        const committed = await call(`/values/${encodeURIComponent(`'Operaciones'!C${reserved[1]}`)}?valueInputOption=RAW`, 'PUT', {
          majorDimension: 'ROWS', values: [['registered']]
        });
        if (committed.updatedCells !== 1) throw new Error('Invalid confirmation');
        return true;
      })();
      return await Promise.race([operation, new Promise((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new Error('Write timeout')); }, timeoutMs);
      })]);
    } catch (error) {
      // Do not expose provider errors, credentials, financial values or request URLs.
      if (error.code === 'OPERATION_PENDING') throw Object.assign(new Error('Operation pending'), { code: 'OPERATION_PENDING' });
      throw new Error('Movement unavailable');
    } finally { clearTimeout(timer); }
  };
}
