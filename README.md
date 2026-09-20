# JarvisLifeTracker

PWA estática sin frameworks. Google Identity Services obtiene la identidad y la API separada en `backend/` valida el token y autoriza una única cuenta configurada en su entorno privado. No hay Sheets ni datos financieros. «Explorar demo sin iniciar sesión» permanece público. No hay credenciales privadas en el repositorio.

## Ejecutar localmente

Con Node.js instalado, abre una terminal en esta carpeta y ejecuta:

```sh
node scripts/serve.cjs
```

Abre **http://localhost:8000/** y detén el servidor con Ctrl+C. Usa exactamente ese origen: `127.0.0.1` y otros puertos no están autorizados en el cliente OAuth actual. Si tienes definida la variable `PORT`, elimínala de esa terminal o ajústala a `8000`. El servidor es solo una herramienta local; no se despliega ni es necesario en GitHub Pages. No abras index.html mediante file://.

## Probar Google Sign-In

Para desarrollo local, sigue [backend/README.md](backend/README.md) para instalar la API, descubrir tu sub y configurar `AUTHORIZED_GOOGLE_SUB`. `config.js` selecciona por hostname: `localhost` y `127.0.0.1` usan `http://127.0.0.1:8080`; `luigytc.github.io` usa exclusivamente `https://jarvislifetracker-505633966366.northamerica-south1.run.app`. Otros hosts quedan sin backend configurado. Esta selección no amplía los orígenes autorizados por OAuth o CORS: para iniciar sesión localmente sigue usando `http://localhost:8000`.

La versión PWA 2.3.2 renueva la caché de configuración. Publica juntos los recursos frontend modificados y pulsa «Actualizar» cuando aparezca, o cierra todas las ventanas de la PWA y vuelve a abrirla. Una pestaña con una versión anterior puede seguir usando sus scripts hasta activar la actualización. En producción, `auth.js` también rechaza cualquier backend distinto de Cloud Run antes de enviar la identidad.

1. Con conexión, espera el botón oficial «Continuar con Google» y púlsalo. Usa la cuenta que registraste como usuario de prueba en Google Auth Platform.
2. Con backend funcionando y tu cuenta autorizada debe aparecer **«Identidad validada; usuario autorizado por el backend. Todavía no hay datos privados conectados.»** Solo se muestra ante el 200 esperado de `POST /auth/me`. No se muestra perfil/correo ni se decodifica el JWT. Un 401/403/503, error de red o respuesta inesperada no confirma autorización. Sin URL backend se indica que falta configurarlo.
3. La credencial se descarta al terminar la petición. «Descartar identidad o intento», recargar, salir, perder conexión o entrar a demo también descarta estado y aborta peticiones; respuestas tardías no restauran autorización. No cierra tu sesión global de Google ni revoca la credencial emitida.
4. Cierra la ventana de Google sin completar el login: no debe aparecer identidad recibida. Puedes pulsar de nuevo el botón, descartar el intento o abrir la demo. GIS no proporciona un callback general de cierre/error para este botón; no se simula detección de cancelación.
5. Si no carga GIS, aparecerá un mensaje y «Reintentar cargar Google» (la espera máxima de carga es 15 segundos). Revisa conexión, bloqueadores y permisos de ventanas emergentes. Si Google rechaza el origen/cliente o la cuenta de prueba, revisa esa configuración en Google Cloud; los detalles los muestra Google. No compartas tokens ni capturas que los contengan.
6. En DevTools → Application, verifica que nuestra app no haya persistido la credencial en almacenamiento o cookies. Cache Storage solo debe contener recursos estáticos de Jarvis; no GIS ni respuestas autenticadas. Google administra sus propias cookies/sesiones; Jarvis no escribe cookies de autenticación.

La recepción real con tu cuenta requiere esta prueba manual. Las pruebas automatizadas usan dobles de GIS y valores ficticios, no cuentas ni credenciales reales.

## Instalación y pruebas manuales

1. Abre la página con conexión. Comprueba que aparece el botón oficial de Google, que puedes entrar al dashboard mediante «Explorar demo sin iniciar sesión» y que aparece «Aplicación lista para usarse sin conexión».
2. En Chrome o Edge, usa «Instalar JarvisLifeTracker» cuando el navegador habilite el botón, o su menú de instalación. La disponibilidad depende del navegador y de si ya está instalada.
3. En iPhone/iPad, abre el sitio HTTPS en Safari → Compartir → Añadir a pantalla de inicio. Hay instrucciones visibles en la página para navegadores sin beforeinstallprompt.
4. En DevTools → Application, revisa el manifiesto, los iconos, el service worker activado y Cache Storage. En Network activa Offline y recarga normalmente: deben funcionar tanto la pantalla inicial como el dashboard. Prueba también /?prueba=offline y /index.html?prueba=offline.
5. Desactiva Offline. Para ensayar una actualización, cambia un recurso y aumenta VERSION en sw.js. Recarga: aparecerá «Actualizar» una vez descargada la nueva versión. Al pulsarlo se activa y recarga; al ser una demo sin sesión, vuelve a la pantalla inicial. Las demás pestañas controladas también se recargan.
6. Comprueba que Cache Storage conserva solo la versión actual de esta app. Las cachés de otros proyectos no deben borrarse.
7. Para probar un fallo de actualización, aumenta VERSION y simula un 404 de un recurso precargado en un entorno de pruebas. La nueva versión no debe activarse y la anterior debe seguir disponible. Restaura el recurso y recarga con conexión para reintentar.

La primera visita necesita conexión. Offline funcionan la pantalla estática y la demo, pero Google Sign-In requiere internet. El almacenamiento del navegador puede borrarse o ser desalojado; en ese caso será necesaria otra visita con internet. No se garantiza funcionamiento offline para rutas inexistentes o recursos ajenos a la demo.

## GitHub Pages

GitHub Pages aloja únicamente el frontend estático; no ejecuta `backend/`. Conserva la URL HTTPS https://luigytc.github.io/JarvisLifeTracker/. No hay compilación frontend. Todos los recursos y las rutas PWA son relativos. Las rutas inventadas no se convierten en páginas. Al preparar publicaciones futuras, incluye únicamente recursos frontend públicos; nunca directorios privados, archivos .env ni node_modules.

Para probar desde un teléfono usa una URL HTTPS: una IP de red local servida por HTTP no habilita normalmente el service worker.

## Política de caché y actualizaciones

- VERSION en sw.js es la versión de la aplicación estática. **Auméntala en cada publicación que cambie un archivo precargado**, incluidos HTML, CSS, JS, manifiesto e iconos. Publica todos los archivos juntos.
- Precarga completa con solicitudes cache: reload, sin reutilizar la caché HTTP. Una descarga fallida impide activar una versión incompleta.
- Estrategia cache-first para mantener coherente la versión del HTML y sus recursos. Las entradas / e /index.html funcionan offline también con parámetros.
- La actualización espera la acción «Actualizar» o el cierre de todas las pestañas antiguas. La primera instalación no fuerza una recarga.
- En activación se eliminan versiones antiguas de esta app; su prefijo incluye la ruta para separar proyectos del mismo dominio. La caché jarvis-v1 de la demo se elimina únicamente si contiene el app.js de esta ruta.
- Solo se interceptan GET de recursos conocidos del mismo origen. Las solicitudes con Authorization o cache: no-store pasan directamente a la red. No se almacenan APIs, POST ni posibles datos privados futuros. La API deberá responder también Cache-Control: no-store; el Service Worker no controla la caché HTTP del navegador.
- Si Cache Storage falla se intenta la red. Si tampoco hay red se devuelve un error 503 legible. La interfaz informa de fallos de registro o preparación sin impedir usar la demo online.

### Migración desde la demo original

Si ya abriste la versión antigua, la primera recarga puede mostrar su HTML almacenado mientras el navegador descarga el nuevo sw.js. Cierra todas las pestañas/ventanas de esa demo y vuelve a abrirla para activar la nueva versión. Después funcionará el botón de actualización. Para un reinicio limpio de pruebas puedes borrar los datos del sitio desde DevTools, aunque no es necesario en cada publicación.

## Archivos

- index.html: entrada, metadatos, iconos y controles PWA accesibles.
- app.js: pantallas de la demo y datos ficticios.
- auth.js: GIS, credencial en memoria y POST al backend; sin validación JWT local.
- config.js: URL pública de backend configurable.
- backend/: API, contenedor, pruebas y herramienta explícita de bootstrap local.
- styles.css: diseño original y estilos del panel PWA.
- pwa.js: instalación, estados, registro y actualización del service worker.
- manifest.webmanifest: identidad, alcance y presentación instalable.
- sw.js: precarga, versionado, limpieza y respuesta sin conexión.
- icons/icon-192.png e icons/icon-512.png: iconos PNG generados localmente, con monograma J sobre fondo oscuro; no requieren recursos externos.
- scripts/serve.cjs: servidor local sin dependencias, requiere Node.js.

La validación y autorización están implementadas en backend y requieren configurar el sub privado. El frontend está configurado para la API desplegada en Cloud Run; publicar juntos `config.js` y `sw.js` permite que GitHub Pages y las instalaciones PWA reciban la conexión. No hay Google Sheets ni datos financieros reales.

## Preparación de autenticación

La arquitectura está en [docs/auth-architecture.md](docs/auth-architecture.md). GIS usa el cliente web público autorizado para `http://localhost:8000` y `https://luigytc.github.io`. No se usa Client Secret. El token se envía exclusivamente desde memoria a `/auth/me` del backend configurado con `no-store`, sin cookies ni redirects; nunca se imprime, decodifica ni persiste. La demo pública no es una barrera de seguridad.

Tras instalar dependencias backend, ejecuta todas las pruebas con `node --test backend/test/*.test.js tests/*.test.cjs`. Comprueba sintaxis con `node --check` sobre los archivos JavaScript de frontend/backend. Las pruebas no usan credenciales reales.
