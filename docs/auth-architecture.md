# Arquitectura de autenticación de Jarvis

Estado: GIS frontend y API Node implementados, con URL de Cloud Run configurada
para GitHub Pages. Comprobación de acceso a Sheets solo en backend, sin celdas ni datos financieros en la interfaz. La cuenta única requiere configuración privada: nunca
se autoriza automáticamente a la primera cuenta que inicia sesión.

```text
GitHub Pages PWA /JarvisLifeTracker/ (pública)
  → Google Identity Services, callback JS
  → ID token exclusivamente en memoria
  → POST /auth/me con Authorization: Bearer
  → google-auth-library verifica firma, aud, iss, exp
  → comparar sub verificado con AUTHORIZED_GOOGLE_SUB del servidor
  → 200 { authenticated: true, authorized: true }, o denegar
  → GET /api/sheets/status reutiliza esa autorización antes de consultar Sheets con ADC
```

Se cambia el contrato anterior GET /auth/me a **POST**, conforme al requisito actual.
La librería oficial se instala solo en backend. Node HTTP nativo sirve cuatro rutas;
no hace falta framework, Client Secret ni credenciales Cloud para verificar ID tokens.

## Frontera de seguridad

La API verifica cada petición. JWT decodificado, correo, CORS y pantallas ocultas no
autorizan. Solo el sub verificado se compara con AUTHORIZED_GOOGLE_SUB del entorno.
Sin cuenta configurada se cierra el acceso. /auth/me devuelve solo éxito mínimo,
nunca perfil, token o sub. GET /health solo devuelve `{"ok":true}`.

No hay sesiones persistentes, refresh tokens, almacenamiento de tokens ni logs de
solicitudes/excepciones de verificación. La librería puede cachear las claves públicas
de Google, que no contienen datos privados del usuario.

## Frontend y PWA

GIS se carga desde Google, con popup y callback JS, sin One Tap ni selección automática.
La credencial vive en un cierre durante /auth/me y la comprobación posterior de Sheets.
Se descarta al terminar la comprobación o invalidar la identidad. La herramienta
temporal de escritura ha sido retirada.
No se guarda en localStorage, sessionStorage, IndexedDB, cookies propias o archivos.
No se imprime, decodifica ni exporta. Google gestiona sus propias cookies de sesión.

config.js define solo URL pública: `http://127.0.0.1:8080` desde los hosts locales `localhost`/`127.0.0.1`
y `https://jarvislifetracker-505633966366.northamerica-south1.run.app` desde
el host `luigytc.github.io`; queda vacía en otros hosts. Esta selección no amplía CORS ni OAuth.
Antes de enviar identidad desde GitHub Pages, auth.js exige el origen exacto de Cloud Run.
No se toma de parámetros de página ni respuestas.
Fuera de loopback se exige HTTPS. Peticiones con credentials: omit, cache: no-store,
redirect: error y timeout de 12 segundos por petición; token solo a /auth/me y,
tras autorizar, a /api/sheets/status del mismo origen configurado. Solo un
200 con ambos booleanos verdaderos y sin campos adicionales confirma autorización.
401/403/503, red caída o respuesta inesperada nunca habilitan acceso privado.

Descartar, abrir demo, salir o perder conexión aborta la petición y descarta estado.
Un contador invalida respuestas tardías. El mensaje autorizado acredita esa consulta,
no una sesión permanente: futuras rutas de datos deberán verificar en cada petición.
Salir no revoca tokens emitidos; revocación inmediata por sesión requeriría un
mecanismo posterior del backend. No existe todavía sección privada.

La demo es pública. El Service Worker solo precarga recursos estáticos conocidos;
excluye APIs, otros orígenes, POST, Authorization y cache: no-store. No cachea GIS.
Todas las respuestas de API llevan Cache-Control: no-store, incluso errores.
No hay fallback offline de API a HTML. Se conservan rutas relativas y /JarvisLifeTracker/.

## CORS y origen

Solo http://localhost:8000 y https://luigytc.github.io, con preflight para el método
de cada ruta y cabeceras Authorization y Content-Type. Nunca * ni cookies. Sin
Origin se sigue verificando identidad. Las subcarpetas GitHub Pages comparten origen:
no son fronteras de seguridad. No cargar scripts no confiables. Si se cambia a
cookies o POST directo de GIS, diseñar CSRF para ese flujo; este usa bearer explícito.

## Bootstrap fuera de la API

backend/tools/discover-sub.js --discover-sub, con NODE_ENV=development y terminal
interactiva, sirve una página temporal en localhost:8000. Usa la misma validación
y muestra el sub solo en la terminal privada; no escribe archivos ni lo devuelve
al navegador. No autoriza automáticamente. Rechaza Cloud Run/CI, cierra tras éxito
o cinco minutos y se excluye de Docker mediante .dockerignore y COPY explícito.

Procedimiento: [backend/README.md](../backend/README.md). El propietario lo ejecuta
en privado; no debe pegar tokens o el identificador aquí ni en Git.

| Valor | Ubicación |
| --- | --- |
| Client ID, URL API, orígenes y base Pages | Públicos; frontend/backend |
| AUTHORIZED_GOOGLE_SUB | Identificador privado; solo entorno backend |
| Tokens y claves privadas | Secretos; nunca Git, logs o almacenamiento frontend |
| OAuth Client Secret | No se usa |
| ID Sheet | Identificador público fijo, exclusivamente en configuración backend |
| Identidad de servicio | Service account adjunta a Cloud Run; credenciales automáticas ADC |

## Cloud Run y comprobación de Sheets

Contenedor Node 24, usuario node no-root, escucha PORT en 0.0.0.0 sin archivos
privados ni bootstrap. Cloud Run termina TLS. La API es invocable por navegador
y autoriza en su código; no confundir audiencia OAuth GIS con IAM Cloud Run.

El backend comprueba acceso al spreadsheet fijo mediante `GoogleAuth` (ADC) y el
alcance `spreadsheets.readonly`. Usa `spreadsheets.get` con `fields=spreadsheetId`;
no solicita celdas ni títulos. La respuesta de la API propia es solo
`{"connected":true}` o un error genérico sin datos del proveedor. El plazo de la
comprobación es de 8 segundos. No se envía el ID token del usuario a Sheets.
La biblioteca administra el access token de servicio en memoria en el backend.
No hay proxy de hojas arbitrarias ni credenciales de servicio en el frontend.
`/health` y `/auth/me` no dependen de la disponibilidad de Sheets.

## Escritura estructurada de movimientos

POST /api/movimientos atraviesa la misma autorización y valida un JSON cerrado de
diez campos (incluido operationId UUID v4) antes de llamar a Sheets. El spreadsheet y Movimientos A:I están
fijados en backend. Un cliente ADC separado solicita scope spreadsheets y añade
una sola fila mediante append, INSERT_ROWS y RAW. Los strings se almacenan
literalmente sin interpretar fórmulas; el monto sigue siendo un número.
No hay interpretación de lenguaje natural ni interfaz de escritura. No se registra
el payload ni errores internos. La respuesta solo confirma registered:true o un
error genérico. Operaciones A:C persiste UUID, timestamp y estado antes de escribir.
Un UUID confirmado devuelve duplicate:true; pending bloquea nuevos appends con 409.
No se reintenta automáticamente una escritura. Las reservas inciertas requieren
reconciliación manual. Contrato, algoritmo y límites de atomicidad:
[movimientos-idempotency.md](movimientos-idempotency.md).
