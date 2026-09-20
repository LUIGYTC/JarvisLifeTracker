const app=document.querySelector('#app');
const demo={cash:'$••,•••',debt:'$••,•••',invest:'$••,•••',month:'$••,•••'};
let disposeAuth = () => {};
// Public demo only. Real authorization must be enforced by the future backend.
function login() {
  disposeAuth();
  app.innerHTML = `<main class="login"><section class="card loginbox">
    <div class="logo">J</div><h1>Jarvis</h1>
    <p>Tu panel personal para gastos, cuentas, tarjetas e inversiones.</p>
    <div id="google-signin" aria-describedby="auth-status"></div>
    <p id="auth-status" class="notice" role="status" aria-live="polite" aria-atomic="true">Cargando el inicio de sesión de Google…</p>
    <button class="google demo-button" id="retry-google" type="button" hidden>Reintentar cargar Google</button>
    <button class="google demo-button" id="clear-identity" type="button" hidden>Descartar identidad o intento</button>
    <!-- TEMPORARY controlled-write verification; remove after checking the test row. -->
    <button class="google demo-button" id="register-test" type="button" hidden disabled>Registrar prueba $0.01</button>
    <p id="test-write-status" class="notice" role="status" aria-live="polite"></p>
    <button class="google demo-button" id="open-demo" type="button">Explorar demo sin iniciar sesión</button>
    <div class="notice">Demo pública con datos ficticios. No solicita ni almacena información financiera.</div>
  </section></main>`;
  disposeAuth = window.JarvisAuth.mount({
    button: document.querySelector('#google-signin'),
    status: document.querySelector('#auth-status'),
    retry: document.querySelector('#retry-google'),
    clear: document.querySelector('#clear-identity'),
    testWrite: document.querySelector('#register-test'),
    testStatus: document.querySelector('#test-write-status')
  });
  document.querySelector('#open-demo').onclick = () => { disposeAuth(); dashboard(); };
}
function dashboard(){app.innerHTML=`<main class="shell"><header class="top"><div><div class="brand">JarvisLifeTracker</div><div class="muted">Dashboard · modo demo</div></div><div class="pill">Demo pública · sin sesión</div></header><section class="grid"><article class="card"><div class="label">Efectivo disponible</div><div class="value">${demo.cash}</div></article><article class="card"><div class="label">Deuda en tarjetas</div><div class="value">${demo.debt}</div></article><article class="card"><div class="label">Inversiones</div><div class="value">${demo.invest}</div></article><article class="card"><div class="label">Gasto este mes</div><div class="value">${demo.month}</div></article><article class="card wide"><div class="label">Gasto mensual</div><div class="bars"><div class="bar" style="height:42%"></div><div class="bar" style="height:68%"></div><div class="bar" style="height:54%"></div><div class="bar" style="height:82%"></div><div class="bar" style="height:61%"></div><div class="bar" style="height:74%"></div></div></article><article class="card wide"><div class="label">Próximos movimientos</div><div class="list"><div class="row"><span>Pago de tarjeta</span><b>Próximamente</b></div><div class="row"><span>Aportación a inversión</span><b>Pendiente</b></div><div class="row"><span>Corte mensual</span><b>Pendiente</b></div></div></article></section><section class="section"><h2>Estado del sistema</h2><div class="card"><span class="muted">Estás explorando una demo pública. Esta demo no usa la identidad ni concede acceso privado. No hay acceso a Google Sheets ni datos reales.</span></div></section></main>`}
login();

