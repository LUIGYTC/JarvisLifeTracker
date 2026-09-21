(() => {
  const CONFIG = Object.freeze({ preparacionHoras: 1, trasladoHoras: 1, minimoHoras: 6, idealHoras: 8 });
  const CONTEXT_DAYS = 2;
  const HOUR = 3600000;
  // UTC is only a civil-calendar arithmetic coordinate, never a timezone claim.
  function civil(value) {
    if (typeof value !== 'string' || !/^(?!0000)\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00$/.test(value)) throw new Error('Invalid civil timestamp');
    const n = Date.parse(value + 'Z');
    if (!Number.isFinite(n) || new Date(n).toISOString().slice(0, 19) !== value) throw new Error('Invalid civil timestamp');
    return n;
  }
  const stamp = value => new Date(value).toISOString().slice(0, 19);
  function calculate(turnos, config = CONFIG) {
    const { preparacionHoras, trasladoHoras, minimoHoras, idealHoras } = config;
    if (![preparacionHoras, trasladoHoras, minimoHoras, idealHoras].every(n => Number.isFinite(n) && n >= 0) ||
        minimoHoras <= 0 || idealHoras < minimoHoras) throw new Error('Invalid rest configuration');
    const ordered = turnos.map((item, index) => {
      const start = civil(item.inicioReal), end = civil(item.finReal);
      if (end <= start) throw new Error('Invalid shift interval');
      return { item, index, start, end };
    }).sort((a, b) => a.start - b.start || a.end - b.end);
    let previousEnd = -Infinity;
    return ordered.map(({ item, index, start, end }) => {
      const wake = start - (preparacionHoras + trasladoHoras) * HOUR;
      const idealStart = wake - idealHoras * HOUR;
      const minimumStart = wake - minimoHoras * HOUR;
      const availableStart = Math.max(idealStart, previousEnd);
      const availableHours = Math.max(0, (wake - availableStart) / HOUR);
      const estado = availableHours >= idealHoras ? 'ideal' : availableHours >= minimoHoras ? 'reducido' : 'recuperacion_prioritaria';
      previousEnd = Math.max(previousEnd, end);
      return { index, fechaTurno: item.fechaTurno, inicioTrabajo: item.inicioReal,
        despertar: stamp(wake), objetivoHoras: idealHoras, minimoHoras, estado,
        ventana: availableHours > 0 ? { inicio: stamp(availableStart), fin: stamp(wake) } : null,
        limiteMinimo: availableHours >= minimoHoras ? stamp(minimumStart) : null };
    });
  }
  window.JarvisDescanso = Object.freeze({ CONFIG, CONTEXT_DAYS, calculate });
})();
