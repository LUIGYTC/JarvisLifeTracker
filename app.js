const app=document.querySelector('#app');
let disposeAuth = () => {};
// Financial data is loaded only after backend authorization; public exploration stays separate.
function login() {
  disposeAuth();
  app.innerHTML = `<main class="login" id="login-screen"><section class="card loginbox">
    <div class="logo">J</div><h1>Jarvis</h1>
    <p>Tu panel personal para gastos, cuentas, tarjetas e inversiones.</p>
    <div id="google-signin" aria-describedby="auth-status"></div>
    <p id="auth-status" class="notice" role="status" aria-live="polite" aria-atomic="true">Cargando el inicio de sesión de Google…</p>
    <button class="google demo-button" id="retry-google" type="button" hidden>Reintentar cargar Google</button>
    <button class="google demo-button" id="clear-identity" type="button" hidden>Descartar identidad o intento</button>
    <button class="google demo-button" id="open-demo" type="button">Explorar demo sin iniciar sesión</button>
    <div class="notice">Inicia sesión para consultar los datos de demostración. La exploración pública no carga datos privados.</div>
  </section></main><section id="dashboard-screen" hidden aria-label="Dashboard">
    <nav class="dashboard-nav shell" aria-label="Navegación del dashboard"><strong>Jarvis</strong><button class="demo-button" id="exit-dashboard" type="button">Salir y volver al inicio</button></nav>
    <div id="dashboard-data" tabindex="-1"></div>
  </section>`;
  const loginScreen = document.querySelector('#login-screen');
  const dashboardScreen = document.querySelector('#dashboard-screen');
  const dashboardData = document.querySelector('#dashboard-data');
  disposeAuth = window.JarvisAuth.mount({
    button: document.querySelector('#google-signin'),
    status: document.querySelector('#auth-status'),
    retry: document.querySelector('#retry-google'),
    clear: document.querySelector('#clear-identity'),
    onDashboard: (state, data) => {
      window.JarvisDashboard.render(dashboardData, state, data);
      const showing = state !== 'reset';
      loginScreen.hidden = showing;
      dashboardScreen.hidden = !showing;
      if (state === 'loading' || state === 'loaded') {
        window.scrollTo(0, 0);
        dashboardData.focus({ preventScroll: true });
      }
    }
  });
  document.querySelector('#exit-dashboard').onclick = () => { login(); window.scrollTo(0, 0); };
  document.querySelector('#open-demo').onclick = () => { disposeAuth(); dashboard(); };
}
function dashboard(){ window.JarvisDashboard.render(app, 'demo'); }
login();
