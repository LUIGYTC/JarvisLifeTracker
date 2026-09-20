export const TEXT_LIMITS = Object.freeze({ categoria: 100, descripcion: 500, metodo: 100, origen: 100, textoOriginal: 2000 });
const fields = ['fecha', 'hora', 'tipo', 'categoria', 'monto', 'descripcion', 'metodo', 'origen', 'textoOriginal'];

export function movimientoRow(value) {
  const invalid = () => { throw new Error('Invalid movement'); };
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).length !== fields.length || fields.some(key => !Object.hasOwn(value, key))) invalid();
  if (typeof value.fecha !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.fecha) || value.fecha.startsWith('0000')) invalid();
  const date = new Date(`${value.fecha}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value.fecha) invalid();
  if (typeof value.hora !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value.hora)) invalid();
  if (!['Gasto', 'Ingreso'].includes(value.tipo)) invalid();
  if (typeof value.monto !== 'number' || !Number.isFinite(value.monto) || value.monto <= 0) invalid();
  for (const [key, limit] of Object.entries(TEXT_LIMITS)) {
    if (typeof value[key] !== 'string' || !value[key].trim() || value[key].length > limit) invalid();
  }
  // Preserve strings exactly. Sheets RAW input makes every string literal.
  return fields.map(key => value[key]);
}

export function readMovementBody(req, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    const fail = status => finish(Object.assign(new Error('Invalid request body'), { status }));
    const timer = setTimeout(() => fail(408), timeoutMs);
    function finish(error, value) {
      clearTimeout(timer);
      req.off('data', data); req.off('end', end); req.off('error', errorEvent); req.off('aborted', errorEvent);
      if (error) { req.resume(); reject(error); } else resolve(value);
    }
    function data(chunk) {
      size += chunk.length;
      if (size > 16384) return fail(413);
      chunks.push(chunk);
    }
    function end() {
      try {
        const text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
        finish(null, JSON.parse(text));
      } catch { fail(400); }
    }
    function errorEvent() { fail(400); }
    req.on('data', data); req.on('end', end); req.on('error', errorEvent); req.on('aborted', errorEvent);
  });
}
