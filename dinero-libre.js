(() => {
  const money = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });
  const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const reasons = {
    compromisos_solo_lectura: 'Compromisos solo informativos en esta fase; no se apartan ni ejecutan automáticamente.',
    periodo_sin_confirmar: 'Falta confirmar el inicio de la catorcena.',
    regla_sin_confirmar: 'Fecha o regla pendiente de confirmar.',
    metodo_sin_confirmar: 'Cuenta de débito pendiente de confirmar.',
    conciliar_compromiso: 'Pendiente de conciliar con los pagos registrados.',
    conciliar_corte: 'Hay movimientos posteriores; falta confirmar el saldo pendiente del corte.',
    corte_sin_conciliar: 'Falta confirmar cuándo se actualizó el saldo del corte.',
    corte_inconsistente: 'Los importes y el estado del corte no coinciden.',
    corte_duplicado: 'Hay registros duplicados del mismo corte.',
    cortes_solapados: 'Varios cortes pendientes pueden incluir el mismo saldo; falta conciliarlos.',
    compromiso_duplicado: 'Hay registros duplicados del compromiso.',
    pago_sin_periodo: 'Falta la fecha del pago para identificar su periodo.',
    pago_futuro: 'La fecha de pago necesita revisión.',
    estado_compromiso: 'Estado del compromiso pendiente de confirmar.',
    estado_corte: 'Estado del corte pendiente de confirmar.',
    corte_no_cerrado: 'No se puede confirmar un corte real cerrado.'
  };
  const cents = value => typeof value === 'number' && Number.isFinite(value) && Number.isSafeInteger(Math.round(value * 100)) && Math.abs(value * 100 - Math.round(value * 100)) < 1e-7;
  function render(data) {
    if (!data || !['completo', 'incompleto'].includes(data.estado) || !cents(data.dineroDisponible) ||
      !['compromisos', 'cortes', 'pendientes'].every(key => Array.isArray(data[key])) ||
      ['compromisosApartados', 'cortesPendientes'].some(key => data[key] !== null && (!cents(data[key]) || data[key] < 0)) ||
      [...data.compromisos, ...data.cortes].some(item => !item || typeof item.nombre !== 'string' || !cents(item.monto) || item.monto < 0) ||
      data.pendientes.some(item => !item || !Object.hasOwn(reasons, item.codigo) || typeof item.nombre !== 'string')) throw Error('Invalid data');
    const information = data.compromisosInformativos || [];
    if (!Array.isArray(information) || information.some(item => !item ||
      (!(item.tipo === 'Regla operativa' && item.monto === null) && (!cents(item.monto) || item.monto < 0)) ||
      ['nombre', 'tipo', 'frecuencia', 'estado'].some(key => typeof item[key] !== 'string') ||
      ['proximaFechaPago', 'metodo'].some(key => item[key] !== null && typeof item[key] !== 'string'))) throw Error('Invalid commitments');
    const complete = data.estado === 'completo';
    if (complete && (data.pendientes.length || !cents(data.dineroLibre) || data.compromisosApartados === null || data.cortesPendientes === null ||
      Math.round(data.dineroLibre * 100) !== Math.round(data.dineroDisponible * 100) - Math.round(data.compromisosApartados * 100) - Math.round(data.cortesPendientes * 100))) throw Error('Invalid total');
    if (!complete && (data.dineroLibre !== null || !data.pendientes.length)) throw Error('Invalid incomplete state');
    const amount = value => value === null ? 'Por confirmar' : money.format(value);
    return `<strong class="free-total">${complete ? money.format(data.dineroLibre) : 'Por confirmar'}</strong>
      ${data.periodo ? `<p class="muted">Catorcena: ${escape(data.periodo.inicio)} – ${escape(data.periodo.fin)}</p>` : ''}
      <dl class="free-summary">${[['Dinero disponible', data.dineroDisponible], ['Compromisos apartados', data.compromisosApartados], ['Cortes pendientes', data.cortesPendientes]].map(([name, value]) => `<div><dt>${name}</dt><dd>${amount(value)}</dd></div>`).join('')}</dl>
      ${data.compromisos.length || data.cortes.length ? `<p class="muted">${complete ? 'Desglose de descuentos' : 'Descuentos confirmados · cálculo aún incompleto'}</p><ul class="free-details">${[...data.compromisos.map(item => ({ ...item, label: item.nombre })), ...data.cortes.map(item => ({ ...item, label: `${item.nombre} · Corte ${item.fechaCorte}` }))].map(item => `<li><span>${escape(item.label)}</span><strong>−${money.format(item.monto)}</strong></li>`).join('')}</ul>` : complete ? '<p class="muted">Sin compromisos ni cortes pendientes en este periodo.</p>' : ''}
      ${information.length ? `<h3>Compromisos · solo consulta</h3><ul class="free-details">${information.map(item => `<li><span>${escape(item.nombre)} · ${escape(item.frecuencia)} · ${escape(item.estado)}<br><span class="muted">Próximo pago: ${escape(item.proximaFechaPago ?? 'Por confirmar')} · Método: ${escape(item.metodo ?? 'Por confirmar')}</span></span><strong>${item.monto === null ? 'Monto dinámico' : money.format(item.monto)}</strong></li>`).join('')}</ul>` : ''}
      ${complete ? '' : `<div class="free-incomplete" role="status"><p>Cálculo incompleto. Dinero libre aún no está determinado.</p><ul>${data.pendientes.map(item => `<li>${item.nombre ? `${escape(item.nombre)}: ` : ''}${reasons[item.codigo]}</li>`).join('')}</ul></div>`}`;
  }
  function mount(root) {
    let reader, controller, generation = 0;
    const frame = body => { root.innerHTML = `<div class="shell free-money"><section class="card" aria-label="Dinero libre"><h2>Dinero libre</h2>${body}</section></div>`; };
    async function open() {
      controller?.abort(); const attempt = ++generation; controller = new AbortController();
      frame('<p role="status">Cargando dinero libre…</p>');
      try {
        if (!reader) throw Error('Unavailable');
        const data = await reader(controller.signal);
        if (attempt !== generation || controller.signal.aborted) return;
        frame(render(data));
      } catch {
        if (attempt === generation && !controller.signal.aborted) frame('<p role="alert">No pudimos calcular el dinero libre. Revisa la conexión o los datos pendientes.</p><button type="button" class="credit-retry" data-free-retry>Reintentar</button>');
      }
    }
    root.onclick = event => { if (event.target.closest('[data-free-retry]')) open(); };
    return Object.freeze({ open, setReader(value) { reader = value; }, reset() { generation++; controller?.abort(); controller = null; reader = null; root.innerHTML = ''; } });
  }
  window.JarvisFreeMoney = Object.freeze({ mount });
})();
