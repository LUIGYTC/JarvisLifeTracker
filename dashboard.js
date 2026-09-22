(() => {
  const money = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });
  const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const amount = value => money.format(value);
  const number = value => typeof value === 'number' && Number.isFinite(value);
  function validate(data) {
    if (!data?.summary || !['ingresos', 'gastos', 'balance', 'movimientos'].every(key => number(data.summary[key])) ||
        !['byCategory', 'byPaymentMethod', 'daily', 'recent'].every(key => Array.isArray(data[key]))) throw new Error('Invalid dashboard');
    for (const [list, key] of [[data.byCategory, 'categoria'], [data.byPaymentMethod, 'metodo']]) {
      if (list.some(item => typeof item[key] !== 'string' || !number(item.total) || item.total < 0)) throw new Error('Invalid dashboard');
    }
    if (data.daily.some(item => typeof item.fecha !== 'string' || !number(item.ingresos) || !number(item.gastos) || item.ingresos < 0 || item.gastos < 0)) throw new Error('Invalid dashboard');
    if (data.recent.some(item => !number(item.monto) || ['fecha', 'descripcion', 'categoria', 'metodo', 'tipo'].some(key => typeof item[key] !== 'string'))) throw new Error('Invalid dashboard');
  }
  function bars(list, key) {
    const max = Math.max(1, ...list.map(item => item.total));
    return list.length ? list.map(item => `<div class="chart-row"><div class="chart-label"><span>${escape(item[key])}</span><strong>${amount(item.total)}</strong></div><div class="track"><div class="fill" style="width:${item.total / max * 100}%"></div></div></div>`).join('') : '<p class="muted">Sin gastos.</p>';
  }
  function render(root, state, data) {
    if (state === 'reset') { root.replaceChildren(); return; }
    if (state !== 'loaded') {
      root.innerHTML = `<section class="shell"><div class="card" role="status">${state === 'loading' ? 'Cargando datos…' : state === 'demo' ? 'Exploración pública. Inicia sesión para cargar tus movimientos.' : 'No pudimos cargar tus datos.'}</div></section>`;
      return;
    }
    validate(data);
    const { summary, daily, recent } = data;
    const max = Math.max(1, ...daily.flatMap(day => [day.ingresos, day.gastos]));
    root.innerHTML = `<main class="shell financial-dashboard">
      <header class="top"><div><div class="brand">Tu actividad</div><p class="muted">Tus movimientos</p></div><span class="pill" role="status">${summary.movimientos ? 'Dashboard cargado' : 'Sin movimientos'}</span></header>
      <section class="grid">${[['Ingresos', amount(summary.ingresos)], ['Gastos', amount(summary.gastos)], ['Balance', amount(summary.balance)], ['Número de movimientos', summary.movimientos]].map(([label, value]) => `<article class="card"><div class="label">${label}</div><div class="value">${value}</div></article>`).join('')}</section>
      <section class="chart-grid section"><article class="card"><h2>Gastos por categoría</h2>${bars(data.byCategory, 'categoria')}</article><article class="card"><h2>Gastos por método de pago</h2>${bars(data.byPaymentMethod, 'metodo')}</article></section>
      <section class="card section"><h2>Ingresos vs gastos por día</h2><p class="muted">Ingresos (verde) · Gastos (azul)</p><div class="daily-chart">${daily.length ? daily.map(day => `<div class="day"><strong>${escape(day.fecha)}</strong><div class="chart-label"><span>Ingresos</span><span>${amount(day.ingresos)}</span></div><div class="track"><div class="fill income" style="width:${day.ingresos / max * 100}%"></div></div><div class="chart-label"><span>Gastos</span><span>${amount(day.gastos)}</span></div><div class="track"><div class="fill" style="width:${day.gastos / max * 100}%"></div></div></div>`).join('') : '<p class="muted">Sin movimientos.</p>'}</div></section>
      <section class="card section"><h2>Movimientos recientes</h2><div class="table-scroll">${recent.length ? `<table><thead><tr><th>Fecha</th><th>Descripción</th><th>Categoría</th><th>Método</th><th>Monto</th><th>Tipo</th></tr></thead><tbody>${recent.map(item => `<tr><td>${escape(item.fecha)}</td><td>${escape(item.descripcion)}</td><td>${escape(item.categoria)}</td><td>${escape(item.metodo)}</td><td>${amount(item.monto)}</td><td>${escape(item.tipo)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">Sin movimientos.</p>'}</div></section></main>`;
  }
  window.JarvisDashboard = Object.freeze({ render });
})();
