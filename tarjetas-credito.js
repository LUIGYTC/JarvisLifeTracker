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
  function detail(card, body, msiBody, cutBody) {
    return `<div class="shell credit-detail"><button type="button" class="demo-button credit-retry" data-credit-back>← Tarjetas de crédito</button>
      <section class="card credit-detail-header section"><p class="muted">${escape(card.tipo)}</p><h1 tabindex="-1" data-credit-heading>${escape(card.tarjeta)}</h1>
        <p class="credit-utilization">${percent.format(card.porcentajeUtilizacion)}% de utilización</p>
        <div class="track" aria-hidden="true"><div class="fill" style="width:${Math.min(100, card.porcentajeUtilizacion)}%"></div></div>
        <dl class="credit-balances"><div class="credit-current"><dt>Saldo actual</dt><dd>${money.format(card.utilizado)}</dd></div>
          <div><dt>Disponible</dt><dd>${money.format(card.disponible)}</dd></div><div><dt>Límite de crédito</dt><dd>${money.format(card.limite)}</dd></div></dl></section>
      <section class="card section credit-next-cut"><h2>Próximo corte</h2><div aria-live="polite" data-credit-cut>${cutBody}</div></section>
      <section class="card section credit-cut"><h2>Información de corte</h2><dl>
        <div><dt>Día de corte</dt><dd>${card.diaCorte ?? 'Sin registrar'}</dd></div>
        ${card.fechaLimitePago ? `<div><dt>Fecha límite de pago</dt><dd>${showDate(card.fechaLimitePago)}</dd></div>` : ''}
        ${card.domiciliadaA ? `<div><dt>Domiciliada a</dt><dd>${escape(card.domiciliadaA)}</dd></div>` : ''}
        <div><dt>Fecha base</dt><dd>${showDate(card.ultimaActualizacion)}</dd></div></dl></section>
      <section class="card section credit-msi"><h2>MSI activos</h2><div aria-live="polite" data-credit-msi>${msiBody}</div></section>
      <section class="card section credit-movements"><h2>Movimientos recientes</h2><div aria-live="polite" data-credit-movements>${body}</div></section></div>`;
  }
  function nextCut(data) {
    if (!data || !['fechaCorte', 'inicioPeriodo', 'finPeriodo'].every(key => typeof data[key] === 'string' &&
        /^(?!0000)\d{4}-\d{2}-\d{2}$/.test(data[key]) && Number.isFinite(Date.parse(data[key])) && new Date(data[key]).toISOString().slice(0, 10) === data[key]) ||
        data.fechaCorte !== data.finPeriodo || data.inicioPeriodo > data.finPeriodo ||
        !['comprasNormales', 'msi', 'totalAcumulado'].every(key => validMoney(data[key]) && data[key] >= 0)) throw new Error('Invalid next cut');
    const cents = Math.round(data.comprasNormales * 100) + Math.round(data.msi * 100);
    if (!Number.isSafeInteger(cents) || cents !== Math.round(data.totalAcumulado * 100)) throw new Error('Invalid next cut');
    return `<p class="next-cut-date"><span class="label">Corte</span><strong>${showDate(data.fechaCorte)}</strong></p>
      <div class="next-cut-total"><span class="label">Total acumulado</span><strong>${money.format(data.totalAcumulado)}</strong></div>
      <dl class="next-cut-breakdown"><div><dt>Compras del periodo</dt><dd>${money.format(data.comprasNormales)}</dd></div><div><dt>MSI</dt><dd>${money.format(data.msi)}</dd></div></dl>
      <p class="muted next-cut-period">Periodo: ${showDate(data.inicioPeriodo)} – ${showDate(data.finPeriodo)}</p>`;
  }
  function msi(data, tarjeta) {
    if (data?.tarjeta !== tarjeta || !Array.isArray(data.compras) || !validMoney(data.totalMensualMSI) || data.totalMensualMSI < 0) throw new Error('Invalid MSI');
    let cents = 0;
    for (const item of data.compras) {
      if (!item || typeof item.compra !== 'string' || !item.compra.trim() || !validMoney(item.mensualidad) || item.mensualidad <= 0 ||
          !Number.isSafeInteger(item.mesActual) || !Number.isSafeInteger(item.mesesTotales) || item.mesActual < 1 || item.mesActual > item.mesesTotales) throw new Error('Invalid MSI');
      if (item.proximoCorte !== null && (typeof item.proximoCorte !== 'string' || !/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(item.proximoCorte) ||
          !Number.isFinite(Date.parse(item.proximoCorte)) || new Date(item.proximoCorte).toISOString().slice(0, 10) !== item.proximoCorte)) throw new Error('Invalid MSI');
      cents += Math.round(item.mensualidad * 100);
      if (!Number.isSafeInteger(cents)) throw new Error('Invalid MSI');
    }
    if (cents !== Math.round(data.totalMensualMSI * 100)) throw new Error('Invalid MSI');
    return `<div class="msi-commitment"><span class="label">Comprometido en próximo corte</span><strong>${money.format(data.totalMensualMSI)}</strong><span class="muted">Solo mensualidades MSI activas</span></div>` +
      (data.compras.length ? `<ul class="credit-transactions">${data.compras.map(item => `<li><div><strong>${escape(item.compra)}</strong><p class="muted">${item.mesActual} de ${item.mesesTotales}</p>
        ${item.proximoCorte ? `<p class="muted">Próximo corte: ${showDate(item.proximoCorte)}</p>` : ''}</div><div class="credit-transaction-amount"><strong>${money.format(item.mensualidad)}</strong><span>/ mes</span></div></li>`).join('')}</ul>`
        : '<p class="muted">No hay compras a MSI activas.</p>');
  }
  function movements(data, tarjeta) {
    if (data?.tarjeta !== tarjeta || !Array.isArray(data.movimientos) || data.movimientos.length > 10) throw new Error('Invalid movements');
    for (const item of data.movimientos) {
      if (!item || !['Ingreso', 'Gasto', 'Transferencia', 'Pago tarjeta'].includes(item.tipo) || !validMoney(item.monto) || item.monto <= 0 ||
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
    let msiReader = null, nextCutReader = null;
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
      const bodies = { movements: '<p role="status">Cargando movimientos…</p>', msi: '<p role="status">Cargando MSI…</p>', cut: '<p role="status">Calculando próximo corte…</p>' };
      root.innerHTML = detail(card, bodies.movements, bodies.msi, bodies.cut);
      if (focus) root.querySelector?.('[data-credit-heading]')?.focus();
      const updateSection = (section, body) => {
        bodies[section] = body;
        const container = root.querySelector?.(`[data-credit-${section}]`);
        if (container) container.innerHTML = body;
        else root.innerHTML = detail(card, bodies.movements, bodies.msi, bodies.cut);
      };
      await Promise.all([
        ['movements', movementReader, movements, 'No se pudieron cargar los movimientos.'],
        ['msi', msiReader, msi, 'No se pudieron cargar los MSI.'],
        ['cut', nextCutReader, nextCut, 'No se pudo calcular el próximo corte.']
      ].map(async ([section, read, format, error]) => {
        try {
          if (section === 'cut' && card.diaCorte === null) { updateSection(section, '<p class="muted">No hay día de corte registrado.</p>'); return; }
          if (!read) throw new Error('Unavailable');
          const data = await read(card.tarjeta, signal);
          if (attempt !== detailGeneration || signal.aborted) return;
          updateSection(section, format(data, card.tarjeta));
        } catch {
          if (attempt !== detailGeneration || signal.aborted) return;
          updateSection(section, `<p role="status">${error}</p><button type="button" class="demo-button credit-retry" data-credit-${section}-retry>Reintentar</button>`);
        }
      }));
      if (attempt === detailGeneration) detailController = null;
    }
    function back() {
      const index = selected;
      cancelDetail(); selected = null;
      render(overview(cards, total));
      root.querySelector?.(`[data-credit-card="${index}"]`)?.focus({ preventScroll: true });
    }
    function reset() {
      cancelDetail();
      cards = []; total = 0; selected = null; movementReader = null; msiReader = null; nextCutReader = null;
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
      if (event.target.closest('[data-credit-msi-retry]')) { if (selected !== null) select(selected, false); return; }
      if (event.target.closest('[data-credit-cut-retry]')) { if (selected !== null) select(selected, false); return; }
      const card = event.target.closest('[data-credit-card]');
      if (card) select(Number(card.dataset.creditCard));
    };
    root.onkeydown = event => {
      const card = event.target.closest('[data-credit-card]');
      if (card && ['Enter', ' '].includes(event.key)) { event.preventDefault(); select(Number(card.dataset.creditCard)); }
    };
    return Object.freeze({ open, reset, setReader(value) { reset(); reader = value; }, setMovementsReader(value) { movementReader = value; }, setMSIReader(value) { msiReader = value; }, setNextCutReader(value) { nextCutReader = value; } });
  }
  window.JarvisTarjetas = Object.freeze({ mount });
})();
