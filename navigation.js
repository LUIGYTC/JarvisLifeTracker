(() => {
  // Module catalog: only implemented modules have a navigation action.
  const modules = [
    { id: 'finanzas', name: 'Finanzas', description: 'Gastos, ingresos y estadísticas', icon: 'M4 19V11M10 19V5M16 19V8M22 19H2', active: true },
    { id: 'casa', name: 'Casa', description: 'Luces, dispositivos y automatización', icon: 'M3 11L12 3L21 11M5 10V21H19V10M9 21V14H15V21' },
    { id: 'rutinas', name: 'Rutinas', description: 'Hábitos, tareas y automatizaciones', icon: 'M3 6L5 8L8 4M11 6H21M3 14L5 16L8 12M11 14H21M11 21H21', active: true },
    { id: 'inversiones', name: 'Inversiones', description: 'Portafolio y seguimiento', icon: 'M3 19L9 13L13 16L21 5M14 5H21V12' }
  ];

  function mount(root, onExit) {
    let active = false;
    let current = 'home';
    root.innerHTML = `<nav class="dashboard-nav shell" aria-label="Navegación de Jarvis">
      <strong>JARVIS</strong><button class="demo-button" id="close-session" type="button">Cerrar sesión</button></nav>
      <main id="jarvis-home" class="shell jarvis-home" tabindex="-1">
        <header class="home-welcome"><p class="home-eyebrow">TU ESPACIO PERSONAL</p><h1>Bienvenido a Jarvis</h1><p class="muted">Todo lo que importa, en un solo lugar.</p></header>
        <section class="module-grid" aria-label="Módulos de Jarvis">${modules.map(module => `<button type="button" class="module-card card${module.active ? ' module-active' : ''}" id="module-${module.id}" ${module.active ? '' : 'disabled'}>
          <svg class="module-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${module.icon}"/></svg>
          <span class="module-title">${module.name}</span><span class="module-description">${module.description}</span>
          <span class="module-state">${module.active ? 'Abrir módulo →' : 'Próximamente'}</span></button>`).join('')}</section>
      </main><section id="finance-view" hidden aria-label="Finanzas">
        <div class="shell finance-navigation"><button id="back-home" type="button" class="demo-button">← Volver a Jarvis</button></div>
        <div id="dashboard-data" tabindex="-1"></div></section><section id="rutinas-view" hidden aria-label="Rutinas"><div class="shell finance-navigation"><button id="rutinas-back" type="button" class="demo-button">&#8592; Volver a Jarvis</button></div><div id="rutinas-content" class="shell routines" tabindex="-1"></div></section>`;
    const home = root.querySelector('#jarvis-home');
    const finance = root.querySelector('#finance-view');
    const content = root.querySelector('#dashboard-data');
    const routines = root.querySelector('#rutinas-view');
    const routineContent = root.querySelector('#rutinas-content');
    const calendar = window.JarvisRutinas.mount(routineContent);
    function show(view) {
      if (!active || !['home', 'finanzas', 'rutinas'].includes(view)) return;
      current = view;
      home.hidden = view !== 'home';
      finance.hidden = view !== 'finanzas';
      routines.hidden = view !== 'rutinas';
      window.scrollTo(0, 0);
      (view === 'home' ? home : view === 'rutinas' ? routineContent : content).focus({ preventScroll: true });
    }
    root.querySelector('#module-finanzas').onclick = () => show('finanzas');
    root.querySelector('#module-rutinas').onclick = () => show('rutinas');
    root.querySelector('#rutinas-back').onclick = () => show('home');
    root.querySelector('#back-home').onclick = () => show('home');
    root.querySelector('#close-session').onclick = onExit;
    return Object.freeze({
      update(state, data) {
        window.JarvisDashboard.render(content, state, data);
        if (state === 'reset') {
          active = false;
          current = 'home';
          root.hidden = true;
          finance.hidden = true;
          routines.hidden = true;
          calendar.reset();
          home.hidden = false;
          return;
        }
        const entering = !active;
        active = true;
        root.hidden = false;
        if (entering) show('home');
        // Loading completion does not move someone away from their chosen module.
        else if (current === 'finanzas' && state === 'loaded') content.focus({ preventScroll: true });
      }
    });
  }
  window.JarvisNavigation = Object.freeze({ mount });
})();
