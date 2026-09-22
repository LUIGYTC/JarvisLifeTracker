(() => {
  const money = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });
  const percent = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 2 });
  const date = new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const color = index => `hsl(${(215 + index * 137.508) % 360} 70% 70%)`;
  const validMoney = value => typeof value === 'number' && Number.isFinite(value) &&
    Number.isSafeInteger(Math.round(value * 100)) && Math.abs(value * 100 - Math.round(value * 100)) < 1e-7;
  function validate(data) {
    if (!Array.isArray(data?.tarjetas)) throw new Error('Invalid cards');
    for (const card of data.tarjetas) {
      if (!card || typeof card.tarjeta !== 'string' || !card.tarjeta.trim() ||
          !['limite', 'utilizado', 'disponible'].every(key => validMoney(card[key])) || card.limite < 0 || card.utilizado < 0 ||
          typeof card.porcentajeUtilizacion !== 'number' || !Number.isFinite(card.porcentajeUtilizacion) || card.porcentajeUtilizacion < 0 ||
          (card.diaCorte !== null && (!Number.isInteger(card.diaCorte) || card.diaCorte < 1 || card.diaCorte > 31))) throw new Error('Invalid cards');
      if (card.fechaLimitePago !== null) {
        const value = card.fechaLimitePago;
        if (typeof value !== 'string' || !/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value) ||
            !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) throw new Error('Invalid cards');
      }
    }
    const total = data.tarjetas.reduce((sum, card) => sum + Math.round(card.utilizado * 100), 0);
    if (!Number.isSafeInteger(total)) throw new Error('Invalid total');
    return total / 100;
  }
  function overview(cards, total) {
    let offset = 0;
    const segments = cards.map((card, index) => {
      const share = total > 0 ? card.utilizado / total * 100 : 0;
      const segment = share > 0 ? `<circle cx="60" cy="60" r="46" fill="none" stroke="${color(index)}" stroke-width="12" pathLength="100" stroke-dasharray="${share} ${100 - share}" stroke-dashoffset="${-offset}"/>` : '';
      offset += share;
      return segment;
    }).join('');
    return `<section class="card debt-distribution" aria-labelledby="debt-title"><h2 id="debt-title">Distribución de deuda</h2>
      <div class="debt-layout"><div class="debt-donut"><svg viewBox="0 0 120 120" role="img" aria-label="Distribución del saldo utilizado por tarjeta; importes en la leyenda">
        <circle cx="60" cy="60" r="46" fill="none" stroke="#273244" stroke-width="12"/><g transform="rotate(-90 60 60)">${segments}</g></svg>
        <div class="debt-total"><span class="label">Deuda total</span><strong>${money.format(total)}</strong></div></div>
        <ul class="debt-legend">${cards.map((card, index) => `<li><span class="debt-dot" style="background:${color(index)}" aria-hidden="true"></span><span>${escape(card.tarjeta)}</span><strong>${money.format(card.utilizado)}<small>${percent.format(total ? card.utilizado / total * 100 : 0)}% de deuda</small></strong></li>`).join('')}</ul></div>
      ${total === 0 ? '<p class="muted">Sin deuda utilizada.</p>' : ''}</section>
      <section class="credit-grid section" aria-label="Tus tarjetas">${cards.map(card => `<article class="card credit-card" tabindex="0">
        <h2>${escape(card.tarjeta)}</h2><span class="label">Utilizado</span><div class="value">${money.format(card.utilizado)}</div>
        <div class="credit-utilization"><span>${percent.format(card.porcentajeUtilizacion)}% de utilización</span><span>Límite ${money.format(card.limite)}</span></div>
        <div class="track" aria-hidden="true"><div class="fill" style="width:${Math.min(100, card.porcentajeUtilizacion)}%"></div></div>
        <dl><div><dt>Disponible</dt><dd>${money.format(card.disponible)}</dd></div><div><dt>Día de corte</dt><dd>${card.diaCorte ?? 'Sin registrar'}</dd></div>
        ${card.fechaLimitePago ? `<div><dt>Fecha límite de pago</dt><dd>${escape(date.format(new Date(`${card.fechaLimitePago}T00:00:00Z`)))}</dd></div>` : ''}</dl>
      </article>`).join('')}</section>`;
  }
  function mount(root) {
    let reader = null, controller = null, generation = 0, state = 'idle';
    function render(body) {
      root.innerHTML = `<div class="shell credit-overview"><header class="top"><h1>Tarjetas de crédito</h1></header>${body}</div>`;
    }
    async function open() {
      if (!reader || state === 'loading' || state === 'loaded') return;
      const attempt = ++generation;
      controller = new AbortController();
      const signal = controller.signal;
      state = 'loading';
      render('<div class="card" role="status">Cargando tarjetas…</div>');
      try {
        const data = await reader(signal);
        if (attempt !== generation || signal.aborted) return;
        const total = validate(data);
        render(data.tarjetas.length ? overview(data.tarjetas, total) : '<div class="card" role="status">No hay tarjetas de crédito registradas.</div>');
        state = 'loaded';
      } catch {
        if (attempt !== generation || signal.aborted) return;
        state = 'error';
        render('<div class="card" role="status"><p>No se pudieron cargar tus tarjetas.</p><button class="demo-button credit-retry" type="button" data-credit-retry>Reintentar</button></div>');
      } finally {
        if (attempt === generation) controller = null;
      }
    }
    function reset() {
      generation++;
      controller?.abort();
      controller = null;
      reader = null;
      state = 'idle';
      root.innerHTML = '';
    }
    root.onclick = event => {
      if (event.target.closest('[data-credit-retry]') && state === 'error') open();
    };
    return Object.freeze({ open, reset, setReader(value) { reset(); reader = value; } });
  }
  window.JarvisTarjetas = Object.freeze({ mount });
})();
