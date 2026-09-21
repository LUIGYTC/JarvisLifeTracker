(() => {
  // Local civil dates: never convert calendar selections through UTC.
  function date(year, month, day) {
    const value = new Date(0);
    value.setFullYear(year, month, day);
    value.setHours(12, 0, 0, 0);
    return value;
  }
  function monthDays(year, month) {
    const first = date(year, month, 1);
    const count = date(year, month + 1, 0).getDate();
    return { offset: (first.getDay() + 6) % 7, count };
  }
  // Future days may contain an array of blocks, including multiple work blocks.
  // These are visual categories only, not a scheduling or persistence model.
  const types = Object.freeze({ work: 'Trabajo', training: 'Entrenamiento', recovery: 'Sueño/recuperación', personal: 'Evento personal' });
  const escape = value => String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  function mount(root, now = () => new Date()) {
    let selected, year, month;
    let reader = null, opened = false, request = null, revision = 0, loadedKey = '', state = 'empty', turnos = [];
    const key = day => `${String(year).padStart(4, '0')}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const blocks = day => turnos.filter(item => item.fechaTurno === key(day));
    let descanso = [], descansoError = false;
    const restLabels = { ideal: 'Descanso ideal', reducido: 'Descanso reducido', recuperacion_prioritaria: 'Recuperación prioritaria' };
    const restFor = day => descanso.filter(item => item.fechaTurno === key(day));
    function clearRest() { descanso = []; descansoError = false; }
    function restDetail() {
      if (state !== 'loaded') return '';
      if (descansoError) return '<p>No se pudo calcular el descanso.</p>';
      const items = restFor(selected);
      if (!items.length) return '<p class="muted">Sin horario laboral que condicione el descanso.</p>';
      const labelTime = timestamp => timestamp.slice(11, 16);
      return `<section class="rest-detail"><h3>Sueño</h3>${items.map(item => `<div class="rest-block">${items.length > 1 ? `<h4>Trabajo: ${labelTime(item.inicioTrabajo)}</h4>` : ''}${item.estado === 'recuperacion_prioritaria' ? '<p>Prioriza descanso</p>' : `<p>Hora ideal de dormir: ${labelTime(item.ventana.inicio)}</p><p>Despertar: ${labelTime(item.despertar)}</p>`}</div>`).join('')}</section>`;
    }
    function reset() {
      revision++; request?.abort(); request = null;
      reader = null; opened = false; loadedKey = ''; state = 'empty'; turnos = [];
      clearRest();
      today();
    }
    async function load() {
      if (!opened || !reader) return;
      const contextDate = day => {
        const value = date(year, month, day);
        return `${String(value.getFullYear()).padStart(4, '0')}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
      };
      const margin = window.JarvisDescanso.CONTEXT_DAYS;
      const from = contextDate(1 - margin), to = contextDate(monthDays(year, month).count + margin);
      if (loadedKey === from && (state === 'loaded' || state === 'loading')) return;
      request?.abort();
      const controller = new AbortController(); request = controller;
      const attempt = ++revision;
      loadedKey = from; state = 'loading'; turnos = []; clearRest(); render();
      try {
        const data = await reader(from, to, controller.signal);
        if (attempt !== revision || controller.signal.aborted) return;
        if (!data || !Array.isArray(data.turnos) || data.turnos.length > 10000 || data.turnos.some(item =>
          !item || !['fechaTurno', 'horaInicio', 'horaFin', 'tipo', 'estado', 'nota', 'inicioReal', 'finReal'].every(field => typeof item[field] === 'string') ||
          !/^\d{4}-\d{2}-\d{2}$/.test(item.fechaTurno) || item.fechaTurno < from || item.fechaTurno > to ||
          !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(item.horaInicio) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(item.horaFin) ||
          item.tipo.length > 100 || item.estado.length > 50 || item.nota.length > 500)) throw new Error('Invalid response');
        turnos = data.turnos; state = 'loaded';
        try { descanso = window.JarvisDescanso.calculate(turnos); }
        catch { descanso = []; descansoError = true; }
      } catch {
        if (attempt !== revision || controller.signal.aborted) return;
        turnos = []; state = 'error';
        clearRest();
      }
      renderPreservingFocus();
    }
    function renderPreservingFocus() {
      const focused = root.querySelector(':focus');
      const selector = focused?.dataset?.day ? `[data-day="${focused.dataset.day}"]`
        : focused?.dataset?.action ? `[data-action="${focused.dataset.action}"]` : null;
      render();
      if (selector) root.querySelector(selector)?.focus({ preventScroll: true });
    }
    const fullDate = new Intl.DateTimeFormat('es', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const monthLabel = new Intl.DateTimeFormat('es', { month: 'long', year: 'numeric' });
    function today() {
      const today = now();
      year = today.getFullYear(); month = today.getMonth(); selected = today.getDate();
      render();
      if (opened) load();
    }
    function render() {
      const today = now();
      const { offset, count } = monthDays(year, month);
      root.innerHTML = `<header class="routine-heading"><h1>Rutinas</h1><p class="muted">Organiza tus turnos, descanso y entrenamiento.</p></header>
        <section class="card routine-calendar" aria-label="Calendario mensual">
          <div class="calendar-toolbar"><button type="button" data-action="previous" aria-label="Mes anterior">‹</button><h2 aria-live="polite">${monthLabel.format(date(year, month, 1))}</h2><button type="button" data-action="next" aria-label="Mes siguiente">›</button></div>
          <button type="button" class="calendar-today" data-action="today">Mes actual</button>
          <div class="calendar-week" aria-hidden="true">${['L','M','X','J','V','S','D'].map(label => `<span>${label}</span>`).join('')}</div>
          <div class="calendar-days">${'<span aria-hidden="true"></span>'.repeat(offset)}${Array.from({ length: count }, (_, i) => {
            const day = i + 1;
            const isToday = year === today.getFullYear() && month === today.getMonth() && day === today.getDate();
            const items = blocks(day);
            const recommendations = restFor(day);
            const severity = ['recuperacion_prioritaria', 'reducido', 'ideal'].find(value => recommendations.some(item => item.estado === value));
            const indicator = severity ? `<span class="rest-indicator" aria-hidden="true">${severity === 'ideal' ? '☾' : severity === 'reducido' ? '☾−' : '☾!'}</span>` : '';
            const compact = items.length ? `<span class="shift-summary" aria-hidden="true">${items[0].horaInicio.replace(':00', '')}–${items[0].horaFin.replace(':00', '')}${items.length > 1 ? `<span>+${items.length - 1}</span>` : ''}</span>` : '';
            return `<button type="button" data-day="${day}" aria-label="${fullDate.format(date(year, month, day))}${items.length ? `, ${items.length} turnos` : ''}${severity ? `, ${restLabels[severity]}` : ''}" aria-pressed="${day === selected}"${isToday ? ' aria-current="date"' : ''}>${day}${compact}${indicator}</button>`;
          }).join('')}</div>
        </section><section class="card routine-detail" aria-live="polite" aria-atomic="true"><h2>${fullDate.format(date(year, month, selected))}</h2>${state === 'loading' ? '<p>Cargando turnos...</p>' : state === 'error' ? '<p>No se pudieron cargar los turnos</p>' : blocks(selected).length ? blocks(selected).map(item => `<article class="routine-block shift-block" data-type="work"><h3>${escape(item.tipo)}</h3><p>${item.horaInicio}–${item.horaFin}</p><p class="shift-state${item.estado === 'Tentativo' ? ' tentative' : ''}">${escape(item.estado)}</p>${item.nota ? `<p>${escape(item.nota)}</p>` : ''}</article>`).join('') : '<p class="muted">Sin información registrada</p>'}${restDetail()}</section>`;
    }
    function changeMonth(delta) {
      const next = date(year, month + delta, 1);
      year = next.getFullYear(); month = next.getMonth();
      selected = Math.min(selected, monthDays(year, month).count);
      turnos = []; state = 'empty'; clearRest();
      render();
      load();
    }
    root.onclick = event => {
      const button = event.target.closest('button');
      if (!button || !root.contains(button)) return;
      const action = button.dataset.action;
      if (action === 'previous') changeMonth(-1);
      else if (action === 'next') changeMonth(1);
      else if (action === 'today') today();
      else if (button.dataset.day) { selected = Number(button.dataset.day); render(); }
      // Replacing calendar markup must not lose keyboard focus.
      root.querySelector(action ? `[data-action="${action}"]` : `[data-day="${selected}"]`)?.focus({ preventScroll: true });
    };
    reset();
    return Object.freeze({ reset, setReader(value) { reader = value; }, open() { opened = true; load(); } });
  }
  window.JarvisRutinas = Object.freeze({ mount, monthDays, types });
})();
