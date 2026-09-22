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
      if (typeof card.tipo !== 'string' || (card.domiciliadaA !== null && typeof card.domiciliadaA !== 'string')) throw new Error('Invalid cards');
      for (const value of [card.fechaLimitePago, card.ultimaActualizacion]) {
        if (value === null) continue;
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
      <section class="credit-grid section" aria-label="Tus tarjetas">${cards.map((card, index) => `<article class="card credit-card" tabindex="0" role="button" data-credit-card="${index}" aria-label="Ver detalle de ${escape(card.tarjeta)}">
        <h2>${escape(card.tarjeta)}</h2><span class="label">Utilizado</span><div class="value">${money.format(card.utilizado)}</div>
        <div class="credit-utilization"><span>${percent.format(card.porcentajeUtilizacion)}% de utilización</span><span>Límite ${money.format(card.limite)}</span></div>
        <div class="track" aria-hidden="true"><div class="fill" style="width:${Math.min(100, card.porcentajeUtilizacion)}%"></div></div>
        <dl><div><dt>Disponible</dt><dd>${money.format(card.disponible)}</dd></div><div><dt>Día de corte</dt><dd>${card.diaCorte ?? 'Sin registrar'}</dd></div>
        ${card.fechaLimitePago ? `<div><dt>Fecha límite de pago</dt><dd>${escape(date.format(new Date(`${card.fechaLimitePago}T00:00:00Z`)))}</dd></div>` : ''}</dl>
      </article>`).join('')}</section>`;
  }
  const showDate = value => value ? escape(date.format(new Date(`${value}T00:00:00Z`))) : 'Sin registrar';
  function detail(card, body) {
    return `<div class="shell credit-detail"><button type="button" class="demo-button credit-retry" data-credit-back>← Tarjetas de crédito</button>
      <section class="card credit-detail-header section"><p class="muted">${escape(card.tipo)}</p><h1 tabindex="-1" data-credit-heading>${escape(card.tarjeta)}</h1>
        <p class="credit-utilization">${percent.format(card.porcentajeUtilizacion)}% de utilización</p>
        <div class="track" aria-hidden="true"><div class="fill" style="width:${Math.min(100, card.porcentajeUtilizacion)}%"></div></div>
        <dl class="credit-balances"><div class="credit-current"><dt>Saldo actual</dt><dd>${money.format(card.utilizado)}</dd></div>
          <div><dt>Disponible</dt><dd>${money.format(card.disponible)}</dd></div><div><dt>Límite de crédito</dt><dd>${money.format(card.limite)}</dd></div></dl></section>
      <section class="card section credit-cut"><h2>Información de corte</h2><dl>
        <div><dt>Día de corte</dt><dd>${card.diaCorte ?? 'Sin registrar'}</dd></div>
        ${card.fechaLimitePago ? `<div><dt>Fecha límite de pago</dt><dd>${showDate(card.fechaLimitePago)}</dd></div>` : ''}
        ${card.domiciliadaA ? `<div><dt>Domiciliada a</dt><dd>${escape(card.domiciliadaA)}</dd></div>` : ''}
        <div><dt>Última actualización</dt><dd>${showDate(card.ultimaActualizacion)}</dd></div></dl></section>
      <section class="card section credit-movements"><h2>Movimientos recientes</h2><div aria-live="polite" data-credit-movements>${body}</div></section></div>`;
  }
  function movements(data, tarjeta) {
    if (data?.tarjeta !== tarjeta || !Array.isArray(data.movimientos) || data.movimientos.length > 10) throw new Error('Invalid movements');
    for (const item of data.movimientos) {
      if (!item || !['Ingreso', 'Gasto'].includes(item.tipo) || !validMoney(item.monto) || item.monto <= 0 ||
          typeof item.descripcion !== 'string' || typeof item.categoria !== 'string' ||
          typeof item.fecha !== 'string' || !/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(item.fecha) ||
          !Number.isFinite(Date.parse(item.fecha)) || new Date(item.fecha).toISOString().slice(0, 10) !== item.fecha) throw new Error('Invalid movements');
    }
    if (!data.movimientos.length) return '<p class="muted">Aún no hay movimientos registrados con esta tarjeta.</p>';
    return `<ul class="credit-transactions">${data.movimientos.map(item => `<li><div><strong>${escape(item.descripcion)}</strong>
      <p class="muted">${showDate(item.fecha)} · ${escape(item.categoria)}</p></div><div class="credit-transaction-amount"><strong>${money.format(item.monto)}</strong><span>${escape(item.tipo)}</span></div></li>`).join('')}</ul>`;
  }
  function mount(root) {
    let reader = null, controller = null, generation = 0, state = 'idle';
    let cards = [], total = 0, selected = null, movementReader = null, detailController = null, detailGeneration = 0;
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
        total = validate(data);
        cards = data.tarjetas;
        render(cards.length ? overview(cards, total) : '<div class="card" role="status">No hay tarjetas de crédito registradas.</div>');
        state = 'loaded';
      } catch {
        if (attempt !== generation || signal.aborted) return;
        state = 'error';
        render('<div class="card" role="status"><p>No se pudieron cargar tus tarjetas.</p><button class="demo-button credit-retry" type="button" data-credit-retry>Reintentar</button></div>');
      } finally {
        if (attempt === generation) controller = null;
      }
    }
    function cancelDetail() { detailGeneration++; detailController?.abort(); detailController = null; }
    async function select(index, focus = true) {
      if (state !== 'loaded' || !Number.isInteger(index) || !cards[index]) return;
      cancelDetail();
      selected = index;
      const card = cards[index], attempt = detailGeneration;
      detailController = new AbortController();
      const signal = detailController.signal;
      root.innerHTML = detail(card, '<p role="status">Cargando movimientos…</p>');
      if (focus) root.querySelector?.('[data-credit-heading]')?.focus();
      const updateMovements = body => {
        const container = root.querySelector?.('[data-credit-movements]');
        if (container) container.innerHTML = body;
        else root.innerHTML = detail(card, body);
      };
      try {
        if (!movementReader) throw new Error('Unavailable');
        const data = await movementReader(card.tarjeta, signal);
        if (attempt !== detailGeneration || signal.aborted) return;
        updateMovements(movements(data, card.tarjeta));
      } catch {
        if (attempt !== detailGeneration || signal.aborted) return;
        updateMovements('<p role="status">No se pudieron cargar los movimientos.</p><button type="button" class="demo-button credit-retry" data-credit-movements-retry>Reintentar</button>');
      } finally { if (attempt === detailGeneration) detailController = null; }
    }
    function back() {
      const index = selected;
      cancelDetail(); selected = null;
      render(overview(cards, total));
      root.querySelector?.(`[data-credit-card="${index}"]`)?.focus({ preventScroll: true });
    }
    function reset() {
      cancelDetail();
      cards = []; total = 0; selected = null; movementReader = null;
      generation++;
      controller?.abort();
      controller = null;
      reader = null;
      state = 'idle';
      root.innerHTML = '';
    }
    root.onclick = event => {
      if (event.target.closest('[data-credit-retry]') && state === 'error') open();
      if (state !== 'loaded') return;
      if (event.target.closest('[data-credit-back]')) { back(); return; }
      if (event.target.closest('[data-credit-movements-retry]')) { if (selected !== null) select(selected, false); return; }
      const card = event.target.closest('[data-credit-card]');
      if (card) select(Number(card.dataset.creditCard));
    };
    root.onkeydown = event => {
      const card = event.target.closest('[data-credit-card]');
      if (card && ['Enter', ' '].includes(event.key)) { event.preventDefault(); select(Number(card.dataset.creditCard)); }
    };
    return Object.freeze({ open, reset, setReader(value) { reset(); reader = value; }, setMovementsReader(value) { movementReader = value; } });
  }
  window.JarvisTarjetas = Object.freeze({ mount });
})();
