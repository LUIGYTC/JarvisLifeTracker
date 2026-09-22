// Public OAuth identifier. Authorization remains exclusively a backend concern.
(() => {
  const CLIENT_ID = '505633966366-vfpj4puk76rksfoankm4bljdq4m5gpb4.apps.googleusercontent.com';
  let credential = null; // Never expose, decode, log or persist this value.
  let scriptPromise;
  let initialized = false;
  let view = null;
  let accepting = false;
  let request = null;
  let generation = 0;
  let authorized = false;
  const reads = new Set();

  function clearCredential() {
    authorized = false;
    for (const controller of reads) controller.abort();
    reads.clear();
    view?.onDashboard?.('reset');
    credential = null;
    accepting = false;
    generation++;
    request?.abort();
    request = null;
  }

  function authEndpoint() {
    const base = window.JarvisConfig?.apiBaseUrl;
    if (!base) return null;
    const url = new URL(base);
    const local = ['localhost', '127.0.0.1'].includes(window.location.hostname) &&
      ['http:', 'https:'].includes(window.location.protocol) &&
      url.origin === 'http://127.0.0.1:8080';
    // Reject stale or overridden configuration before sending any identity.
    if (window.location.hostname === 'luigytc.github.io' &&
        url.origin !== 'https://jarvislifetracker-505633966366.northamerica-south1.run.app') {
      throw new Error('Invalid production API origin');
    }
    if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) ||
        url.username || url.password || url.search || url.hash || url.pathname !== '/') {
      throw new Error('Invalid API origin');
    }
    return new URL('/auth/me', url).href;
  }

  async function receiveIdentity(response) {
    if (!view || !accepting || !navigator.onLine) return;
    clearCredential();
    if (typeof response?.credential !== 'string' || !response.credential.trim()) {
      view.status.textContent = 'Google no devolvió una identidad. Intenta de nuevo.';
      view.clear.hidden = true;
      return;
    }
    credential = response.credential;
    view.clear.hidden = false;
    view.button.hidden = true;
    const current = view;
    const attempt = generation;
    let timer;
    try {
      const endpoint = authEndpoint();
      if (!endpoint) {
        credential = null;
        current.status.textContent = 'Identidad recibida; falta configurar el backend. Ningún dato privado está autorizado.';
        return;
      }
      current.status.textContent = 'Verificando identidad con el backend…';
      const controller = new AbortController();
      request = controller;
      timer = setTimeout(() => controller.abort(), 12000);
      const result = await fetch(endpoint, {
        method: 'POST', headers: { Authorization: `Bearer ${credential}` },
        credentials: 'omit', cache: 'no-store', redirect: 'error', signal: request.signal
      });
      if (attempt !== generation || view !== current) return;
      if (result.status === 401) {
        current.status.textContent = 'Identidad inválida o expirada. Vuelve a iniciar sesión con Google.';
      } else if (result.status === 403) {
        current.status.textContent = 'Acceso denegado por el backend. Esta cuenta no está autorizada.';
      } else if (result.status === 503) {
        current.status.textContent = 'El backend aún no tiene habilitada la autorización. No hay acceso privado.';
      } else if (result.status === 200) {
        const data = await result.json();
        if (attempt !== generation || view !== current) return;
        if (!data || data.authenticated !== true || data.authorized !== true || Object.keys(data).length !== 2) {
          throw new Error('Unexpected response');
        }
        const authorizedMessage = 'Identidad validada; usuario autorizado por el backend.';
        current.status.textContent = `${authorizedMessage} Comprobando conexión con Google Sheets…`;
        clearTimeout(timer);
        timer = setTimeout(() => controller.abort(), 12000);
        try {
          const sheets = await fetch(new URL('/api/sheets/status', endpoint).href, {
            method: 'GET', headers: { Authorization: `Bearer ${credential}` },
            credentials: 'omit', cache: 'no-store', redirect: 'error', signal: controller.signal
          });
          if (attempt !== generation || view !== current) return;
          if (sheets.status !== 200) throw new Error('Sheets unavailable');
          const status = await sheets.json();
          if (attempt !== generation || view !== current) return;
          if (controller.signal.aborted || !status || status.connected !== true || Object.keys(status).length !== 1) {
            throw new Error('Unexpected Sheets response');
          }
          current.status.textContent = `${authorizedMessage} Google Sheets conectado.`;
          authorized = true;
          const readCredit = async (path, signal) => {
            if (!authorized || !credential || attempt !== generation || view !== current) throw new Error('Unavailable');
            const read = new AbortController();
            const abort = () => read.abort();
            signal?.addEventListener('abort', abort, { once: true });
            if (signal?.aborted) read.abort();
            reads.add(read);
            const deadline = setTimeout(abort, 12000);
            try {
              read.signal.throwIfAborted();
              const response = await fetch(new URL(path, authEndpoint()).href, {
                method: 'GET', headers: { Authorization: `Bearer ${credential}` },
                credentials: 'omit', cache: 'no-store', redirect: 'error', signal: read.signal });
              if (attempt !== generation || view !== current || read.signal.aborted) throw new Error('Unavailable');
              if (response.status === 401 || response.status === 403) {
                clearCredential();
                current.button.hidden = !navigator.onLine;
                current.status.textContent = 'Vuelve a iniciar sesión con Google.';
              }
              if (response.status !== 200) throw new Error('Unavailable');
              const data = await response.json();
              if (attempt !== generation || view !== current || read.signal.aborted) throw new Error('Unavailable');
              return data;
            } finally {
              clearTimeout(deadline);
              signal?.removeEventListener('abort', abort);
              reads.delete(read);
            }
          };
          current.onCardExpensesReader?.(signal => readCredit('/api/gastos-tarjetas', signal));
          current.onTarjetasReader?.(signal => readCredit('/api/tarjetas-credito', signal));
          current.onTarjetaMovimientosReader?.((tarjeta, signal) => readCredit(
            `/api/tarjetas-credito/movimientos?${new URLSearchParams({ tarjeta })}`, signal));
          current.onMSIReader?.((tarjeta, signal) => readCredit(
            `/api/tarjetas-credito/msi?${new URLSearchParams({ tarjeta })}`, signal));
          current.onNextCutReader?.((tarjeta, signal) => readCredit(
            `/api/tarjetas-credito/proximo-corte?${new URLSearchParams({ tarjeta })}`, signal));
          current.onTurnosReader?.(async (from, to, signal) => {
            if (!authorized || !credential || attempt !== generation || view !== current) throw new Error('Unavailable');
            const read = new AbortController();
            const abort = () => read.abort();
            signal?.addEventListener('abort', abort, { once: true });
            if (signal?.aborted) read.abort();
            reads.add(read);
            const deadline = setTimeout(abort, 12000);
            try {
              const url = new URL('/api/turnos', authEndpoint());
              url.searchParams.set('from', from);
              url.searchParams.set('to', to);
              const response = await fetch(url.href, { method: 'GET',
                headers: { Authorization: `Bearer ${credential}` }, credentials: 'omit',
                cache: 'no-store', redirect: 'error', signal: read.signal });
              if (attempt !== generation || view !== current || read.signal.aborted) throw new Error('Unavailable');
              if (response.status === 401 || response.status === 403) {
                clearCredential();
                current.button.hidden = !navigator.onLine;
                current.status.textContent = 'Vuelve a iniciar sesión con Google.';
              }
              if (response.status !== 200) throw new Error('Unavailable');
              const data = await response.json();
              if (attempt !== generation || view !== current || read.signal.aborted) throw new Error('Unavailable');
              return data;
            } finally {
              clearTimeout(deadline);
              signal?.removeEventListener('abort', abort);
              reads.delete(read);
            }
          });
          if (current.onDashboard) {
            current.onDashboard('loading');
            clearTimeout(timer);
            timer = setTimeout(() => controller.abort(), 12000);
            try {
              const result = await fetch(new URL('/api/dashboard', endpoint).href, {
                method: 'GET', headers: { Authorization: `Bearer ${credential}` },
                credentials: 'omit', cache: 'no-store', redirect: 'error', signal: controller.signal
              });
              if (result.status !== 200) throw new Error('Dashboard unavailable');
              const dashboard = await result.json();
              if (attempt !== generation || view !== current || controller.signal.aborted) return;
              current.onDashboard('loaded', dashboard);
            } catch {
              if (attempt === generation && view === current) current.onDashboard('error');
            }
          }
        } catch {
          if (attempt === generation && view === current) {
            current.status.textContent = `${authorizedMessage} No se pudo comprobar la conexión con Google Sheets.`;
          }
        }
      } else {
        throw new Error('Unexpected response');
      }
    } catch {
      if (attempt === generation && view === current) {
        current.status.textContent = 'No se pudo confirmar la autorización: error de conexión, configuración o respuesta del backend. Reintenta iniciando sesión; no hay acceso privado.';
      }
    } finally {
      clearTimeout(timer);
      if (attempt === generation) {
        if (!authorized) credential = null;
        request = null;
        current.button.hidden = !navigator.onLine;
      }
    }
  }

  function loadGoogle() {
    if (window.google?.accounts?.id) return Promise.resolve();
    if (scriptPromise) return scriptPromise;
    scriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client?hl=es';
      script.async = true;
      const timer = setTimeout(() => finish(false), 15000);
      function finish(ok) {
        clearTimeout(timer);
        script.onload = script.onerror = null;
        if (ok && window.google?.accounts?.id) resolve();
        else {
          script.remove();
          reject(new Error('GIS unavailable'));
        }
      }
      script.onload = () => finish(true);
      script.onerror = () => finish(false);
      document.head.append(script);
    }).catch(error => {
      scriptPromise = null;
      throw error;
    });
    return scriptPromise;
  }

  async function prepare(current) {
    clearCredential();
    current.clear.hidden = true;
    current.retry.hidden = true;
    current.button.hidden = true;
    if (!navigator.onLine) {
      current.status.textContent = 'Sin conexión: Google requiere internet. Puedes usar la exploración pública.';
      current.retry.hidden = false;
      return;
    }
    current.status.textContent = 'Cargando el inicio de sesión de Google…';
    try {
      await loadGoogle();
      if (view !== current || !navigator.onLine) return;
      if (!initialized) {
        window.google.accounts.id.initialize({
          client_id: CLIENT_ID,
          callback: receiveIdentity,
          ux_mode: 'popup',
          auto_select: false
        });
        initialized = true;
      }
      current.button.replaceChildren();
      current.button.hidden = false;
      window.google.accounts.id.renderButton(current.button, {
        type: 'standard', theme: 'outline', size: 'large',
        text: 'continue_with', shape: 'pill', locale: 'es',
        width: Math.min(360, Math.max(200, current.button.clientWidth)),
        click_listener: () => {
          if (view !== current || !navigator.onLine) return;
          clearCredential();
          accepting = true;
          current.clear.hidden = false;
          current.status.textContent = 'Continúa en Google. Si cierras la ventana o no se abre, puedes volver a pulsar el botón o descartar el intento. Todavía no hay acceso privado.';
        }
      });
      current.status.textContent = 'Inicia sesión con Google. El backend debe validar tu identidad y autorizar el acceso.';
    } catch {
      if (view !== current) return;
      current.button.hidden = true;
      current.retry.hidden = false;
      current.status.textContent = 'No se pudo cargar Google. Revisa tu conexión o los bloqueadores y reintenta. La exploración pública sigue disponible.';
    }
  }

  function mount({ button, status, retry, clear, onDashboard, onTurnosReader, onTarjetasReader, onTarjetaMovimientosReader, onMSIReader, onNextCutReader, onCardExpensesReader }) {
    clearCredential();
    const current = { button, status, retry, clear, onDashboard, onTurnosReader, onTarjetasReader, onTarjetaMovimientosReader, onMSIReader, onNextCutReader, onCardExpensesReader };
    view = current;
    clear.hidden = true;
    retry.onclick = () => prepare(current);
    clear.onclick = () => {
      clearCredential();
      clear.hidden = true;
      button.hidden = !navigator.onLine;
      status.textContent = 'Identidad o intento descartado en este dispositivo. No se ha autorizado acceso privado.';
    };
    prepare(current);
    return () => {
      if (view === current) {
        clearCredential();
        view = null;
      }
    };
  }

  window.addEventListener('offline', () => {
    clearCredential();
    if (view) {
      view.clear.hidden = true;
      prepare(view);
    }
  });
  window.addEventListener('online', () => { if (view) prepare(view); });
  window.addEventListener('pagehide', () => {
    clearCredential();
    if (view) {
      view.clear.hidden = true;
      view.status.textContent = 'Identidad descartada al salir. Vuelve a iniciar sesión.';
    }
  });
  window.addEventListener('pageshow', event => {
    if (event.persisted && view) prepare(view);
  });
  // Only a UI lifecycle API is exported; the credential stays in this closure.
  window.JarvisAuth = Object.freeze({ mount });
})();
