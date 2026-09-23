import { GoogleAuth } from 'google-auth-library';
import { SPREADSHEET_ID } from './config.js';

export const DEBIT_RANGES = ["'Cuentas'!A:A", "'Cuentas'!E:E", "'Cuentas'!C:C"];
const invalid = () => { throw new Error('Invalid debit data'); };
const empty = value => value == null || (typeof value === 'string' && !value.trim());

export function aggregateAvailableMoney(names = [], balances = [], types = []) {
  if (![names, balances, types].every(rows => Array.isArray(rows) && rows.length <= 10001 && rows.every(row => Array.isArray(row) && row.length <= 1))) invalid();
  if (!names.length && !balances.length && !types.length) return { total: 0, cuentas: [] };
  if (names[0]?.[0] !== 'Cuenta' || balances[0]?.[0] !== 'Saldo disponible / valor actual' || types[0]?.[0] !== 'Tipo') invalid();
  const cuentas = [], otrasCuentas = [];
  let total = 0;
  for (let i = 1; i < Math.max(names.length, balances.length, types.length); i++) {
    const nombre = names[i]?.[0], saldo = balances[i]?.[0];
    const tipo = types[i]?.[0];
    if (empty(nombre) && empty(saldo) && empty(tipo)) continue;
    if (!['Débito', 'Cuenta remunerada', 'Inversión'].includes(tipo)) invalid();
    // Never present a partial total as the available money if a populated row is invalid.
    if (typeof nombre !== 'string' || !nombre.trim() || nombre.length > 100 ||
        typeof saldo !== 'number' || !Number.isFinite(saldo)) invalid();
    const cents = Math.round(saldo * 100);
    if (!Number.isSafeInteger(cents) || Math.abs(saldo * 100 - cents) > 1e-7) invalid();
    if (tipo === 'Inversión') {
      otrasCuentas.push({ nombre: nombre.trim(), saldo: cents / 100, tipo });
      continue;
    }
    total += cents;
    if (!Number.isSafeInteger(total)) invalid();
    cuentas.push({ nombre: nombre.trim(), saldo: cents / 100 });
  }
  return { total: total / 100, cuentas, ...(otrasCuentas.length ? { otrasCuentas } : {}) };
}

export function createAvailableMoneyReader({
  auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] }),
  fetchImpl = fetch, timeoutMs = 8000
} = {}) {
  return async () => {
    const controller = new AbortController();
    let timer;
    try {
      return await Promise.race([(async () => {
        const client = await auth.getClient();
        const headers = await client.getRequestHeaders();
        controller.signal.throwIfAborted();
        const url = new URL(`https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values:batchGet`);
        for (const range of DEBIT_RANGES) url.searchParams.append('ranges', range);
        url.searchParams.set('valueRenderOption', 'UNFORMATTED_VALUE');
        url.searchParams.set('fields', 'valueRanges(values)');
        const response = await fetchImpl(url, { method: 'GET', headers, signal: controller.signal, cache: 'no-store', redirect: 'error' });
        if (response.status !== 200) invalid();
        const data = await response.json();
        if (!Array.isArray(data.valueRanges) || data.valueRanges.length !== DEBIT_RANGES.length) invalid();
        return aggregateAvailableMoney(data.valueRanges[0].values, data.valueRanges[1].values, data.valueRanges[2].values);
      })(), new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('timeout')); }, timeoutMs); })]);
    } catch { throw new Error('Available money unavailable'); }
    finally { clearTimeout(timer); }
  };
}
