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
    <button class="google demo-button" id="open-demo" type="button">Explorar sin iniciar sesión</button>
    <div class="notice">Inicia sesión para consultar tus movimientos. La exploración pública no carga datos privados.</div>
  </section></main><section id="jarvis-shell" hidden aria-label="Jarvis"></section>`;
  const loginScreen = document.querySelector('#login-screen');
  const navigation = window.JarvisNavigation.mount(document.querySelector('#jarvis-shell'), () => {
    login(); window.scrollTo(0, 0);
  });
  disposeAuth = window.JarvisAuth.mount({
    button: document.querySelector('#google-signin'),
    status: document.querySelector('#auth-status'),
    retry: document.querySelector('#retry-google'),
    clear: document.querySelector('#clear-identity'),
    onTurnosReader: reader => navigation.setTurnosReader(reader),
    onTarjetasReader: reader => navigation.setTarjetasReader(reader),
    onTarjetaMovimientosReader: reader => navigation.setTarjetaMovimientosReader(reader),
    onMSIReader: reader => navigation.setMSIReader(reader),
    onAvailableMoneyReader: reader => navigation.setAvailableMoneyReader(reader),
    onCardExpensesReader: reader => navigation.setCardExpensesReader(reader),
    onNextCutReader: reader => navigation.setNextCutReader(reader),
    onDashboard: (state, data) => {
      navigation.update(state, data);
      loginScreen.hidden = state !== 'reset';
    }
  });
  document.querySelector('#open-demo').onclick = () => { disposeAuth(); dashboard(); };
}
function dashboard(){ window.JarvisDashboard.render(app, 'demo'); }
login();
