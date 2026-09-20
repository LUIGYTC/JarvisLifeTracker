import { GoogleAuth } from 'google-auth-library';
import { SPREADSHEET_ID } from './config.js';

// ADC uses the attached Cloud Run service account. No user ID token is forwarded.
// Request only read access, even when the account has Editor access to the file.
export function createSheetsCheck({
  auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] }),
  timeoutMs = 8000
} = {}) {
  return async () => {
    const controller = new AbortController();
    let timer;
    try {
      const operation = (async () => {
        const client = await auth.getClient();
        // ADC discovery can finish after the overall deadline.
        controller.signal.throwIfAborted();
        const response = await client.request({
          url: `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}`,
          method: 'GET',
          params: { fields: 'spreadsheetId', includeGridData: false },
          signal: controller.signal,
          timeout: timeoutMs,
          retry: false,
          maxRedirects: 0
        });
        if (response.status !== 200 || response.data?.spreadsheetId !== SPREADSHEET_ID) {
          throw new Error('Unexpected Sheets response');
        }
        return true;
      })();
      return await Promise.race([
        operation,
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new Error('Sheets timeout'));
          }, timeoutMs);
        })
      ]);
    } catch {
      // Provider errors can contain request credentials, IDs and response data.
      throw new Error('Sheets unavailable');
    } finally {
      clearTimeout(timer);
    }
  };
}
