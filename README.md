# JarvisLifeTracker

Aplicación estática de demostración, sin frameworks ni dependencias de ejecución. Incluye pantalla de acceso visual y dashboard adaptable. «Continuar con Google» solamente abre la demo: no autentica, no conecta Google Sheets y no guarda datos financieros. No contiene credenciales ni secretos.

## Ejecutar localmente

Con Node.js instalado, abre una terminal en esta carpeta y ejecuta:

```sh
node scripts/serve.cjs
```

Abre http://127.0.0.1:8080/ y detén el servidor con Ctrl+C. El servidor es solo una herramienta local; no se despliega ni es necesario en GitHub Pages. También puedes usar VS Code Live Server en localhost. No abras index.html mediante file://.

## Instalación y pruebas manuales

1. Abre la página con conexión. Comprueba que puedes entrar al dashboard y que aparece «Aplicación lista para usarse sin conexión».
2. En Chrome o Edge, usa «Instalar JarvisLifeTracker» cuando el navegador habilite el botón, o su menú de instalación. La disponibilidad depende del navegador y de si ya está instalada.
3. En iPhone/iPad, abre el sitio HTTPS en Safari → Compartir → Añadir a pantalla de inicio. Hay instrucciones visibles en la página para navegadores sin beforeinstallprompt.
4. En DevTools → Application, revisa el manifiesto, los iconos, el service worker activado y Cache Storage. En Network activa Offline y recarga normalmente: deben funcionar tanto la pantalla inicial como el dashboard. Prueba también /?prueba=offline y /index.html?prueba=offline.
5. Desactiva Offline. Para ensayar una actualización, cambia un recurso y aumenta VERSION en sw.js. Recarga: aparecerá «Actualizar» una vez descargada la nueva versión. Al pulsarlo se activa y recarga; al ser una demo sin sesión, vuelve a la pantalla inicial. Las demás pestañas controladas también se recargan.
6. Comprueba que Cache Storage conserva solo la versión actual de esta app. Las cachés de otros proyectos no deben borrarse.
7. Para probar un fallo de actualización, aumenta VERSION y simula un 404 de un recurso precargado en un entorno de pruebas. La nueva versión no debe activarse y la anterior debe seguir disponible. Restaura el recurso y recarga con conexión para reintentar.

La primera visita necesita conexión. El almacenamiento del navegador puede borrarse o ser desalojado; en ese caso será necesaria otra visita con internet. No se garantiza funcionamiento offline para rutas inexistentes o recursos ajenos a la demo.

## GitHub Pages

Publica el contenido de esta carpeta mediante GitHub Pages y usa su URL HTTPS, por ejemplo https://usuario.github.io/JarvisLifeTracker/. No hay compilación ni backend. Todos los recursos, el identificador, el alcance y la URL inicial del manifiesto son relativos, por lo que también funciona en una subcarpeta. Las rutas inventadas no se convierten en páginas: no es un router SPA.

Para probar desde un teléfono usa una URL HTTPS: una IP de red local servida por HTTP no habilita normalmente el service worker.

## Política de caché y actualizaciones

- VERSION en sw.js es la versión de la aplicación estática. **Auméntala en cada publicación que cambie un archivo precargado**, incluidos HTML, CSS, JS, manifiesto e iconos. Publica todos los archivos juntos.
- Precarga completa con solicitudes cache: reload, sin reutilizar la caché HTTP. Una descarga fallida impide activar una versión incompleta.
- Estrategia cache-first para mantener coherente la versión del HTML y sus recursos. Las entradas / e /index.html funcionan offline también con parámetros.
- La actualización espera la acción «Actualizar» o el cierre de todas las pestañas antiguas. La primera instalación no fuerza una recarga.
- En activación se eliminan versiones antiguas de esta app; su prefijo incluye la ruta para separar proyectos del mismo dominio. La caché jarvis-v1 de la demo se elimina únicamente si contiene el app.js de esta ruta.
- Solo se interceptan GET de recursos conocidos del mismo origen. No se almacenan APIs, POST ni posibles datos privados futuros.
- Si Cache Storage falla se intenta la red. Si tampoco hay red se devuelve un error 503 legible. La interfaz informa de fallos de registro o preparación sin impedir usar la demo online.

### Migración desde la demo original

Si ya abriste la versión antigua, la primera recarga puede mostrar su HTML almacenado mientras el navegador descarga el nuevo sw.js. Cierra todas las pestañas/ventanas de esa demo y vuelve a abrirla para activar la nueva versión. Después funcionará el botón de actualización. Para un reinicio limpio de pruebas puedes borrar los datos del sitio desde DevTools, aunque no es necesario en cada publicación.

## Archivos

- index.html: entrada, metadatos, iconos y controles PWA accesibles.
- app.js: pantallas de la demo y datos ficticios.
- styles.css: diseño original y estilos del panel PWA.
- pwa.js: instalación, estados, registro y actualización del service worker.
- manifest.webmanifest: identidad, alcance y presentación instalable.
- sw.js: precarga, versionado, limpieza y respuesta sin conexión.
- icons/icon-192.png e icons/icon-512.png: iconos PNG generados localmente, con monograma J sobre fondo oscuro; no requieren recursos externos.
- scripts/serve.cjs: servidor local sin dependencias, requiere Node.js.

No se han implementado autenticación, Google Sheets, backend ni datos financieros reales.
