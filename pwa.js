(() => {
  const status = document.querySelector('#pwa-status');
  const installButton = document.querySelector('#install-app');
  const updateButton = document.querySelector('#update-app');
  const help = document.querySelector('#install-help');
  const standalone = window.matchMedia('(display-mode: standalone)');
  let installPrompt;
  let registration;
  let failure = '';
  let offlineReady = false;
  let reloading = false;
  let hadController = Boolean(navigator.serviceWorker?.controller);

  function renderStatus() {
    const messages = [];
    if (!navigator.onLine) messages.push('Sin conexión.');
    if (failure) messages.push(failure);
    else if (registration?.waiting) messages.push('Hay una nueva versión disponible.');
    else if (offlineReady) messages.push('Aplicación lista para usarse sin conexión.');
    status.textContent = messages.join(' ');
    updateButton.hidden = !registration?.waiting;
  }

  function syncInstallUI() {
    const installed = standalone.matches || navigator.standalone === true;
    installButton.hidden = installed || !installPrompt;
    help.hidden = installed;
  }

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    installPrompt = event;
    syncInstallUI();
  });
  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    installButton.hidden = true;
    help.hidden = true;
  });
  standalone.addEventListener('change', syncInstallUI);
  installButton.addEventListener('click', async () => {
    if (!installPrompt) return;
    const prompt = installPrompt;
    installPrompt = null;
    syncInstallUI();
    try {
      await prompt.prompt();
      await prompt.userChoice;
    } catch (error) {
      console.warn('No se pudo abrir la instalación.', error);
      status.textContent = 'Usa el menú de tu navegador para instalar la aplicación.';
    }
  });
  updateButton.addEventListener('click', () => {
    if (registration?.waiting) {
      updateButton.disabled = true;
      status.textContent = 'Actualizando…';
      registration.waiting.postMessage({ type: 'SKIP_WAITING' });
    }
  });
  window.addEventListener('online', renderStatus);
  window.addEventListener('offline', renderStatus);
  syncInstallUI();

  if (!window.isSecureContext || !('serviceWorker' in navigator)) {
    failure = 'El modo sin conexión requiere HTTPS o localhost y un navegador compatible.';
    renderStatus();
    return;
  }

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController && !reloading) {
      reloading = true;
      window.location.reload();
      return;
    }
    hadController = true;
    offlineReady = true;
    renderStatus();
  });

  function watchWorker(worker) {
    if (!worker) return;
    worker.addEventListener('statechange', () => {
      if (worker.state === 'installed') failure = '';
      if (worker.state === 'activated') offlineReady = true;
      if (worker.state === 'redundant') {
        failure = 'No se pudo preparar esta versión sin conexión. Reintenta recargando con internet.';
        updateButton.disabled = false;
      }
      renderStatus();
    });
  }

  navigator.serviceWorker.register('./sw.js', { scope: './', updateViaCache: 'none' })
    .then(result => {
      registration = result;
      offlineReady = Boolean(result.active);
      watchWorker(result.installing);
      result.addEventListener('updatefound', () => watchWorker(result.installing));
      renderStatus();
    })
    .catch(error => {
      console.error('No se pudo registrar el service worker.', error);
      failure = 'No se pudo habilitar el modo sin conexión. Reintenta recargando con internet.';
      renderStatus();
    });
})();
