# Jarvis Home y módulos

La PWA usa vistas internas, sin nuevas páginas HTML, frameworks ni aplicaciones.
Tras el flujo autorizado existente se muestra Home. La lectura financiera continúa
como antes; su carga y resultado se renderizan en la vista Finanzas, inicialmente
oculta. La finalización de la lectura no cambia la vista elegida por el usuario.

`navigation.js` contiene el catálogo visual de módulos y el cambio de vistas.
`app.js` conecta los eventos del flujo actual con esa navegación. `dashboard.js`
sigue siendo el renderizador financiero sin modificaciones. Nuevos módulos pueden
añadir su entrada y controlador de vista sin introducir lógica de negocio en app.js.

Home muestra bienvenida, Finanzas activo y Casa, Rutinas e Inversiones deshabilitados
con «Próximamente». Las tarjetas usan SVG decorativo inline, sin librerías externas.

- Finanzas abre el dashboard ya cargado o su estado de carga/error.
- «Volver a Jarvis» cambia de vista; no desmonta autenticación, no solicita datos
  nuevamente y no altera el dashboard en memoria.
- «Cerrar sesión» ejecuta el descarte existente, borra los datos visibles/en memoria
  de la vista y vuelve al login. No cierra la sesión global de Google.
- Los eventos existentes de salida y pérdida de conexión conservan su limpieza de
  identidad/datos. Recargar requiere el flujo de login existente; no hay persistencia.

La autorización y el ciclo de vida del ID token no cambian: el token se descarta
al terminar las peticiones como antes. La navegación conserva el estado autorizado
y el dashboard de esa carga de página, sin almacenar tokens ni crear una sesión nueva.

Caché estática 2.3.8 incluye navigation.js. Se mantienen todas las exclusiones de
API, Authorization y no-store. Publicar conjuntamente los assets y activar la nueva
versión al desplegar posteriormente. No se cambian rutas, datos ni acceso a Sheets.
