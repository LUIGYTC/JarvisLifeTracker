(() => {
  const money = value => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(value);
  const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const date = value => new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`));
  const palette = ['#3997ff', '#ff925e', '#39d29a', '#ab87ff', '#f36bb2', '#ffc75a', '#21c6d3', '#a5b5ce'];
  // Presentation only: unknown category names remain visible with a generic icon.
  const icons = {
    comida: 'M5 3v7m3-7v7m3-7v7M5 7h6M8 10v11M18 3v18M18 3c-4 3-4 8 0 8',
    transporte: 'M4 10l2-6h12l2 6M3 10h18v8H3zM6 18v3m12-3v3M6 14h2m8 0h2',
    ejercicio: 'M3 8v8m4-11v14m10-14v14m4-11v8M7 12h10',
    entretenimiento: 'M8 7h8c5 0 7 12 3 12l-4-4H9l-4 4C1 19 3 7 8 7zM7 9v5m-2-2h4m7-1h.1m2 2h.1',
    salud: 'M9 3h6v6h6v6h-6v6H9v-6H3V9h6z',
    servicios: 'M9 3v6m6-6v6M6 9h12v3a6 6 0 0 1-6 6v3M6 9v3',
    compras: 'M5 7h14l2 14H3zM8 7V6a4 4 0 0 1 8 0v1',
    hogar: 'M3 11l9-8 9 8M5 10v11h14V10M9 21v-7h6v7'
  };
  const generic = 'M3 3h9l9 9-9 9-9-9zM8 8h.1';
  const icon = path => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${path}"/></svg>`;
  function render(data) {
    const categories = [...data.categorias].sort((a, b) => b.total - a.total || a.categoria.localeCompare(b.categoria));
    const colors = new Map(categories.map((item, index) => [item.categoria, palette[index] || `hsl(${(index * 137.508) % 360} 70% 65%)`]));
    const color = name => colors.get(name);
    const percent = value => new Intl.NumberFormat('es-MX', { maximumFractionDigits: 1 }).format(value) + '%';
    let offset = 0;
    const segments = categories.map(item => {
      const share = item.total / data.total * 100;
      const segment = `<circle cx="60" cy="60" r="45" pathLength="100" fill="none" stroke="${color(item.categoria)}" stroke-width="24" stroke-dasharray="${share} ${100 - share}" stroke-dashoffset="${-offset}"/>`;
      offset += share; return segment;
    }).join('');
    const metric = (label, value, caption, path) => `<section class="card expenses-metric"><span class="expenses-icon">${icon(path)}</span><div><h2>${label}</h2><strong>${value}</strong><p>${caption}</p></div></section>`;
    return `<header class="expenses-header"><h1>Gastos con tarjetas</h1><p class="muted">Mes actual hasta hoy · <time datetime="${data.inicioPeriodo}">${date(data.inicioPeriodo)}</time> – <time datetime="${data.finPeriodo}">${date(data.finPeriodo)}</time></p></header>
      <div class="expenses-metrics">${metric('Total en tarjetas', money(data.total), 'Compras del periodo · MXN', 'M3 5h18v14H3zM3 10h18M6 15h4')}${metric('Número de compras', data.numeroCompras, 'En el periodo', generic)}</div>
      ${!categories.length ? '<section class="card"><h2>Gastos por categoría</h2><p class="muted">Aún no hay gastos con tarjetas en este periodo.</p></section>' : `<div class="expenses-charts"><section class="card"><h2>Gastos por categoría</h2><div class="expenses-distribution"><div class="expenses-donut"><svg viewBox="0 0 120 120" aria-hidden="true"><g transform="rotate(-90 60 60)">${segments}</g></svg><div class="expenses-center"><strong>${money(data.total)}</strong><span>Compras del periodo</span></div></div><ul class="expenses-legend">${categories.map(item => `<li><span class="expenses-dot" style="background:${color(item.categoria)}"></span><span>${escape(item.categoria)}</span><strong>${money(item.total)}</strong><span class="muted">${percent(item.porcentaje)}</span></li>`).join('')}</ul></div></section>
      <section class="card expenses-top"><h2>Top categorías</h2><ul>${categories.slice(0, 5).map(item => `<li style="--category-color:${color(item.categoria)}"><span class="expenses-icon">${icon((Object.hasOwn(icons, item.categoria.toLocaleLowerCase('es-MX')) ? icons[item.categoria.toLocaleLowerCase('es-MX')] : generic))}</span><div><div class="expenses-top-label"><span>${escape(item.categoria)}</span><strong>${money(item.total)}</strong></div><div class="track" aria-hidden="true"><div class="fill" style="width:${item.total / categories[0].total * 100}%"></div></div></div></li>`).join('')}</ul></section></div>`}`;
  }
  function mount(root) {
    let reader, controller, generation = 0;
    const frame = body => { root.innerHTML = `<div class="shell card-expenses">${body}</div>`; };
    async function open() {
      controller?.abort(); const attempt = ++generation;
      controller = new AbortController();
      frame('<h1>Gastos con tarjetas</h1><p role="status">Cargando gastos…</p>');
      try {
        if (!reader) throw new Error('Unavailable');
        const data = await reader(controller.signal);
        if (attempt !== generation || controller.signal.aborted) return;
        frame(render(data));
      } catch {
        if (attempt === generation && !controller.signal.aborted) frame('<h1>Gastos con tarjetas</h1><p role="alert">No pudimos cargar los gastos con tarjetas.</p><button type="button" class="credit-retry" data-expenses-retry>Reintentar</button>');
      }
    }
    root.onclick = event => { if (event.target.closest('[data-expenses-retry]')) open(); };
    return Object.freeze({ open, setReader(value) { reader = value; }, reset() { generation++; controller?.abort(); controller = null; reader = null; root.innerHTML = ''; } });
  }
  window.JarvisCardExpenses = Object.freeze({ mount });
})();
