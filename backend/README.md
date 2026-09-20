# Backend de Jarvis

Node.js 24, HTTP nativo y una dependencia directa: `google-auth-library`. La
librería oficial verifica firma, audiencia, emisor y tiempo usando claves públicas
rotatorias de Google. También exigimos `exp` futuro estricto y `sub` no vacío.
Sin Client Secret ni Service Account JSON. La comprobación de Sheets usa ADC
con la identidad de ejecución de Cloud Run, sin claves descargadas.

## Instalación y variables privadas

Necesitas Node.js 24 con npm (incluido en la distribución oficial de Node):

```powershell
cd C:\JarvisLifeTracker\backend
npm ci --ignore-scripts
```

El lockfile fija versiones. Para iniciar sin archivos ni valores privados en el
historial de comandos, después de obtener tu sub con el procedimiento siguiente:

```powershell
$env:NODE_ENV = 'development'
$env:PORT = '8080'
$env:HOST = '127.0.0.1'
$env:AUTHORIZED_GOOGLE_SUB = Read-Host 'Pega tu sub verificado en esta terminal privada'
npm start
```

No inventes el sub. Sin configurarlo, un token válido recibe 503 y nunca autorización;
un token ausente/inválido recibe 401. El Client ID público esperado está fijado en
`src/config.js`, nunca se obtiene de una petición.

Alternativa: copia `.env.example` a `backend/.env`, edítalo localmente y ejecuta
`npm run dev`. El archivo real está ignorado por Git y excluido del contexto Docker.
Nunca uses `git add -f`, publiques el directorio con `.env` ni copies su contenido
al frontend. El sub es un identificador personal privado, no una contraseña.

## Descubrir el sub explícitamente

No hay endpoint de bootstrap en la API. La herramienta está excluida de la imagen.
Requiere NODE_ENV=development, terminal interactiva y flag `--discover-sub`;
rechaza indicadores Cloud Run/CI. Escucha solo loopback, con ruta aleatoria, nonce,
Host y Origin comprobados. Termina al verificar una identidad o a los cinco minutos.

1. Detén el frontend en puerto 8000 (Ctrl+C) y cierra su pestaña normal.
2. En una terminal privada, sin transcripción/grabación ni redirección de salida:

   ```powershell
   cd C:\JarvisLifeTracker\backend
   $env:NODE_ENV = 'development'
   npm run bootstrap
   ```

   Equivalente: `node tools/discover-sub.js --discover-sub` con esa variable definida.
3. Abre la URL `http://localhost:8000/discover-...` que imprime e inicia sesión con
   la cuenta que deseas autorizar. No copies tokens: GIS los envía desde memoria
   a la herramienta, que usa la misma validación criptográfica que la API.
4. Solo después de verificar, el sub aparece en la terminal privada. El navegador
   recibe únicamente `{"ok":true}`. No se imprime token, correo ni otros claims,
   no se escriben archivos y no se autoriza automáticamente esa cuenta.
5. Copia el identificador a `AUTHORIZED_GOOGLE_SUB` mediante `Read-Host`, o a tu
   `.env` ignorado. No lo compartas en Git/chat. Cierra la pestaña temporal y limpia
   o cierra esa terminal cuando ya no necesites el identificador.
6. Reinicia backend con la variable y vuelve a iniciar el frontend normal.

La herramienta se cierra tras éxito; Ctrl+C la cancela. Puedes eliminar
`backend/tools/` y el script `bootstrap` de package.json después del aprovisionamiento:
la API no depende de ellos. No existe una variable que active bootstrap en la API.
El servidor estático normal solo sirve recursos públicos permitidos, nunca backend.

## Flujo completo

1. Inicia backend con el sub configurado: `npm start` o `npm run dev`.
2. [GET /health](http://127.0.0.1:8080/health) debe devolver `{"ok":true}`.
3. En otra terminal:

   ```powershell
   cd C:\JarvisLifeTracker
   $env:PORT = '8000'
   node scripts/serve.cjs
   ```

4. Abre exactamente `http://localhost:8000/`. Si hay una PWA anterior, pulsa
   «Actualizar» o cierra sus pestañas y vuelve a abrirla para activar versión 2.3.3.
5. Google Sign-In envía `POST http://127.0.0.1:8080/auth/me` con Bearer desde memoria,
   sin cookies, cuerpo ni redirects. La cuenta permitida obtiene **«Identidad validada;
   usuario autorizado por el backend.»**
6. Prueba otra cuenta válida: 403. Token inválido/expirado: 401; sin cuenta configurada:
   503. Red caída o respuesta inesperada: nunca se confirma autorización.
7. Descartar o entrar a demo invalida respuestas en vuelo. No exportes solicitudes
   con Authorization ni copies comandos cURL que contengan tokens reales.

`../config.js` define la URL pública de API: `http://127.0.0.1:8080` desde
los hosts `localhost`/`127.0.0.1` y `https://jarvislifetracker-505633966366.northamerica-south1.run.app`
desde el host `luigytc.github.io`. Los demás hosts quedan sin backend configurado.
OAuth y CORS siguen requiriendo `http://localhost:8000` para el login local.
HTTP solo se permite a loopback desde el origen local. Jamás poner identificadores
personales o credenciales en esa configuración.

## Contrato y seguridad

| Petición | Resultado |
| --- | --- |
| GET /health | 200, `{"ok":true}` sin configuración |
| POST /auth/me sin Bearer o con token inválido/expirado | 401 |
| Token válido, sub no permitido | 403 |
| Token válido, sin sub configurado | 503 |
| Token válido y autorizado | 200, `{"authenticated":true,"authorized":true}` |
| Origin presente no permitido | 403 sin Allow-Origin |
| OPTIONS permitido | 204, Authorization permitido |

CORS solo permite `http://localhost:8000` y `https://luigytc.github.io`. No usa `*`
ni cookies. Los clientes sin Origin siguen sujetos a autenticación: CORS no autoriza.
No se acepta token por URL/cuerpo, ni cuerpos en /auth/me. Todas las respuestas,
incluidos errores, llevan no-store. La API solo registra mensajes mínimos de arranque,
nunca cabeceras, cuerpos, tokens o excepciones de Google. Fallos de verificación,
incluido timeout o indisponibilidad de claves, cierran el acceso con 401.

## Pruebas

```powershell
cd C:\JarvisLifeTracker
node --test backend/test/*.test.js tests/*.test.cjs
```

Las pruebas HTTP usan dobles de verificación. Las de criptografía generan claves
RSA efímeras y tokens sintéticos en memoria y usan el verificador real de Google
con certificados públicos de prueba. Comprueban firma alterada, audiencia/emisor
incorrectos y expiración. No usan tokens reales ni sustituyen el login manual.

## Contenedor y Cloud Run

El frontend apunta al servicio público
`https://jarvislifetracker-505633966366.northamerica-south1.run.app`.
Se verificaron salud (200), preflight desde GitHub Pages (204), rechazo sin
identidad (401) y rechazo de un origen no permitido (403), con `no-store`.
Esto no verifica la cuenta autorizada: el login real sigue siendo una prueba manual.

Construcción local opcional, con Docker instalado:

```powershell
docker build -t jarvis-backend ./backend
```

Node 24, dependencias de producción fijadas, `USER node`, copia explícita solo de src
y manifiestos. `.dockerignore` excluye por defecto todo: .env, herramientas, tests y
dependencias locales. En producción escucha `0.0.0.0:$PORT`; Cloud Run termina TLS.
No poner valores privados en Dockerfile, argumentos de build o repositorio.

Para reproducir el despliegue en otro entorno, elegir proyecto/región, registro de imagen, permisos de build/deploy,
configuración privada AUTHORIZED_GOOGLE_SUB (preferiblemente Secret Manager) y URL
HTTPS pública. Configurar límites de instancias/solicitudes y observabilidad sin
cabeceras Bearer/cuerpos. Se necesita salida HTTPS a las claves públicas de Google.
/health acredita vida, no autorización configurada.

El endpoint debe ser invocable por el navegador a nivel de plataforma; **el código
de la API valida y autoriza**. No confundir el ID token GIS (audiencia cliente OAuth)
con IAM de invocación Cloud Run (otra audiencia). La identidad de ejecución tendrá
acceso al spreadsheet compartido. La comprobación solicita alcance de solo lectura.
No hace falta descargar claves ni configurar GOOGLE_APPLICATION_CREDENTIALS en Cloud Run.

Referencias: [validación Google](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token),
[contrato Cloud Run](https://docs.cloud.google.com/run/docs/container-contract).

## Comprobación privada de Google Sheets

`GET /api/sheets/status` atraviesa exactamente la misma verificación de ID token
y autorización de usuario que `POST /auth/me`. No acepta identificadores, rangos
ni tokens en query/cuerpo. Solo después de autorizar invoca Google Sheets API con
la service account de ejecución mediante Application Default Credentials (ADC).
El token GIS del usuario no se envía a Google Sheets.

`src/config.js` fija el identificador público del spreadsheet exclusivamente en el
backend. `src/sheets.js` reutiliza `google-auth-library`, con alcance
`https://www.googleapis.com/auth/spreadsheets.readonly`, GET `spreadsheets.get`
y máscara `fields=spreadsheetId`. No solicita celdas, títulos, saldos ni movimientos,
no escribe y no devuelve el identificador. El plazo total es de 8 segundos,
incluida la obtención del cliente ADC; los errores del proveedor no se registran
ni se devuelven. No se requiere una dependencia nueva.

| Situación | Respuesta |
| --- | --- |
| Usuario autorizado y acceso real al spreadsheet | 200 `{"connected":true}` |
| Token ausente, inválido o expirado | 401 `{"error":"invalid_identity"}` |
| Usuario válido no autorizado | 403 `{"error":"not_authorized"}` |
| Autorización de usuario sin configurar | 503 `{"error":"authorization_unavailable"}` |
| ADC, permisos Sheets, red, cuota, timeout o respuesta inesperada | 503 `{"error":"sheets_unavailable"}` |

Todas llevan `Cache-Control: no-store`. `/health` sigue siendo público y mínimo;
no consulta Sheets. `/auth/me` conserva su respuesta y no depende de Sheets.
Los tests inyectan dobles de ADC/Sheets y nunca necesitan credenciales reales.

### Verificar después del despliegue en Cloud Run

1. Despliega la nueva imagen conservando la service account y la configuración
   privada de autorización actuales. Sheets API debe estar habilitada y el archivo
   compartido con esa misma cuenta. No añadas archivos de claves ni variables de
   credenciales; ADC usa automáticamente la identidad adjunta.
2. Comprueba `/health`: 200 `{"ok":true}`. Abre `/api/sheets/status` sin token:
   debe devolver 401, no datos. Abrir la URL directamente no prueba autorización.
3. Publica el frontend y activa la actualización PWA 2.3.3. Inicia sesión desde
   GitHub Pages. Tras autorizar mediante /auth/me, se consulta automáticamente
   /api/sheets/status reutilizando el token en memoria. No hacen falta breakpoints
   ni copiar tokens. Éxito: «Google Sheets conectado.».
4. Ante fallo aparece «No se pudo comprobar la conexión con Google Sheets.» sin
   detalles internos. Al terminar se descarta la credencial. Descartar el intento,
   salir, perder conexión o entrar a demo aborta la consulta e invalida respuestas
   tardías. No exportes HAR ni copies headers Authorization.
5. Otra cuenta válida debe recibir 403 en /auth/me y no provocar consultas a Sheets.
   Si el usuario autorizado recibe 503
   `sheets_unavailable`, revisa la identidad de ejecución, la compartición del
   archivo, API habilitada y conectividad/cuota; el endpoint no expone detalles
   internos. Los errores y el timeout ya están cubiertos con dobles en tests.

Referencias: [ADC](https://docs.cloud.google.com/docs/authentication/application-default-credentials),
[spreadsheets.get y selección de campos](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/get).

## Registrar un movimiento estructurado

`POST /api/movimientos` usa la misma verificación de ID token y comparación de
usuario autorizado que las otras rutas privadas. El destino está fijado en el
servidor: spreadsheet configurado y rango `'Movimientos'!A:I`. No acepta campos
de identidad, spreadsheet, hoja ni ningún campo adicional.

Se requiere `Content-Type: application/json` (opcional `charset=utf-8`), sin
compresión. El cuerpo admite hasta 16 KiB y 5 segundos de lectura. Los nueve campos
son obligatorios. Fecha: YYYY-MM-DD real entre años 0001 y 9999; hora: HH:MM de
00:00 a 23:59; tipo: `Gasto` o `Ingreso`; monto: número finito estrictamente
positivo, sin conversión de strings ni redondeo. Los cinco textos deben tener
contenido distinto de espacios y estos máximos de unidades UTF-16:

| Campo | Máximo |
| --- | --- |
| categoria | 100 |
| descripcion | 500 |
| metodo | 100 |
| origen | 100 |
| textoOriginal | 2000 |

Los textos se preservan exactamente: no se recortan ni se les añade un apóstrofo.
La protección contra fórmulas es `valueInputOption=RAW`, que almacena los strings
literalmente, incluso prefijos `=`, `+`, `-`, `@`, espacios, controles y variantes
Unicode. Fecha, hora y tipo también son strings RAW; monto permanece numérico.
No se utiliza `USER_ENTERED`. Esta garantía corresponde a la escritura en Sheets;
una futura exportación CSV necesitaría su propia política de seguridad.

La escritura usa ADC con scope `spreadsheets`, sin dependencia nueva. La consulta
de estado mantiene su cliente de solo lectura. `values.append` con `INSERT_ROWS`
envía una sola fila en orden Fecha, Hora, Tipo, Categoría, Monto, Descripción,
Método, Origen, Texto original, después de la tabla existente en Movimientos A:I.
No envía operaciones a otras hojas ni sobrescribe filas. Google debe confirmar
una fila, nueve columnas y nueve celdas en A:I antes de responder éxito.

Respuestas mínimas, siempre `no-store`: 200 `{"registered":true}`; 400
`{"error":"invalid_movement"}` por validación; 413 por tamaño; 408 por lectura
lenta; 415 por formato de contenido; 401/403 por identidad/autorización; 503
`{"error":"movement_unavailable"}` si no se confirma la escritura. Ninguna
respuesta ni log incluye el movimiento o el error interno de Google.

No hay reintentos automáticos ni redirects al escribir. El límite de 8 segundos
incluye ADC y la respuesta de Sheets. **Una respuesta perdida o timeout puede
ocurrir después de insertar la fila.** No hay garantía de idempotencia entre
peticiones independientes: antes de reintentar, comprobar manualmente la hoja
para evitar duplicar un movimiento. No se afirma éxito ante un resultado incierto.

### Prueba controlada después del despliegue (una fila real)

Despliega solo el backend conservando su service account con acceso Editor. No
hace falta modificar frontend, GIS, caché PWA ni configuración de credenciales.
Esta prueba todavía no se ha ejecutado contra el Sheet real.

En GitHub Pages, abre DevTools → Sources → auth.js y coloca un breakpoint en la
línea `const authorizedMessage`, después de que /auth/me haya autorizado. Inicia
sesión normalmente. Ejecuta **una sola vez** el siguiente fragmento en ese ámbito
pausado: referencia `credential` en memoria, sin copiar ni imprimir su valor.
Después reanuda y retira el breakpoint. No exportes HAR ni cabeceras.

```js
void fetch('https://jarvislifetracker-505633966366.northamerica-south1.run.app/api/movimientos', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${credential}` },
  credentials: 'omit', cache: 'no-store', redirect: 'error',
  signal: AbortSignal.timeout(20000),
  body: JSON.stringify({
    fecha: '2026-09-20', hora: '12:00', tipo: 'Gasto', categoria: 'Prueba técnica',
    monto: 0.01, descripcion: 'PRUEBA CONTROLADA JARVIS 20260920-01',
    metodo: 'Prueba', origen: 'Verificación manual API',
    textoOriginal: 'Fila técnica explícita; no representa un gasto real'
  })
}).then(async result => {
  console.log(result.status, await result.json());
}).catch(() => console.log('Resultado incierto; revisar la hoja antes de reintentar'));
```

Esperado: 200 `{"registered":true}` y exactamente una fila nueva con el marcador
`PRUEBA CONTROLADA JARVIS 20260920-01`. No ejecutar el fragmento otra vez para
comprobar el resultado. Revisar la fila directamente en Sheets. La interfaz de
Jarvis sigue mostrando solo el estado de conexión, sin formulario ni datos reales.

Referencias: [append e INSERT_ROWS](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets.values/append),
[RAW](https://developers.google.com/workspace/sheets/api/reference/rest/v4/ValueInputOption).
