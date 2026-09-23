(() => {
  const money = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });
  const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  function render(data) {
    if (!data || !Number.isFinite(data.total) || !Array.isArray(data.cuentas) || data.cuentas.some(account =>
      typeof account.nombre !== 'string' || !account.nombre.trim() || !Number.isFinite(account.saldo))) throw Error('Invalid data');
    const other = data.otrasCuentas ?? [];
    if (!Array.isArray(other) || other.some(account => !account || account.tipo !== 'Inversión' ||
      typeof account.nombre !== 'string' || !account.nombre.trim() || !Number.isFinite(account.saldo))) throw Error('Invalid accounts');
    const list = accounts => `<ul class="available-accounts">${accounts.map(account =>
      `<li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 10h18L12 3zM5 10v9m7-9v9m7-9v9M3 21h18"/></svg><span>${escape(account.nombre)}</span><strong>${money.format(account.saldo)}</strong></li>`).join('')}</ul>`;
    return `<strong class="available-total">${money.format(data.total)}</strong>${list(data.cuentas)}${data.cuentas.length ? '' : '<p class="muted">Sin cuentas de débito registradas.</p>'}
      ${other.length ? `<h3>Otras cuentas</h3><p class="muted">Valor actual de inversiones · fuera de Dinero disponible</p>${list(other)}` : ''}`;
  }
  function mount(root) {
    let reader, controller, generation = 0;
    const frame = body => { root.innerHTML = `<div class="shell available-money"><section class="card" aria-label="Dinero disponible"><h2>Dinero disponible</h2>${body}</section></div>`; };
    async function open() {
      controller?.abort(); const attempt = ++generation;
      controller = new AbortController();
      frame('<p role="status">Cargando dinero disponible…</p>');
      try {
        if (!reader) throw Error('Unavailable');
        const data = await reader(controller.signal);
        if (attempt !== generation || controller.signal.aborted) return;
        frame(render(data));
      } catch {
        if (attempt === generation && !controller.signal.aborted) frame('<p role="alert">No pudimos cargar el dinero disponible.</p><button type="button" class="credit-retry" data-available-retry>Reintentar</button>');
      }
    }
    root.onclick = event => { if (event.target.closest('[data-available-retry]')) open(); };
    return Object.freeze({ open, setReader(value) { reader = value; }, reset() { generation++; controller?.abort(); controller = null; reader = null; root.innerHTML = ''; } });
  }
  window.JarvisAvailableMoney = Object.freeze({ mount });
})();
