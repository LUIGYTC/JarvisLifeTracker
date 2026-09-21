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
  function mount(root, now = () => new Date()) {
    let selected, year, month;
    const fullDate = new Intl.DateTimeFormat('es', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const monthLabel = new Intl.DateTimeFormat('es', { month: 'long', year: 'numeric' });
    function reset() {
      const today = now();
      year = today.getFullYear(); month = today.getMonth(); selected = today.getDate();
      render();
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
            return `<button type="button" data-day="${day}" aria-label="${fullDate.format(date(year, month, day))}" aria-pressed="${day === selected}"${isToday ? ' aria-current="date"' : ''}>${day}</button>`;
          }).join('')}</div>
        </section><section class="card routine-detail" aria-live="polite" aria-atomic="true"><h2>${fullDate.format(date(year, month, selected))}</h2><p class="muted">Sin información registrada</p><p class="routine-future">Más adelante: turnos, sueño, entrenamiento y eventos.</p></section>`;
    }
    function changeMonth(delta) {
      const next = date(year, month + delta, 1);
      year = next.getFullYear(); month = next.getMonth();
      selected = Math.min(selected, monthDays(year, month).count);
      render();
    }
    root.onclick = event => {
      const button = event.target.closest('button');
      if (!button || !root.contains(button)) return;
      const action = button.dataset.action;
      if (action === 'previous') changeMonth(-1);
      else if (action === 'next') changeMonth(1);
      else if (action === 'today') reset();
      else if (button.dataset.day) { selected = Number(button.dataset.day); render(); }
      // Replacing calendar markup must not lose keyboard focus.
      root.querySelector(action ? `[data-action="${action}"]` : `[data-day="${selected}"]`)?.focus({ preventScroll: true });
    };
    reset();
    return Object.freeze({ reset });
  }
  window.JarvisRutinas = Object.freeze({ mount, monthDays, types });
})();
