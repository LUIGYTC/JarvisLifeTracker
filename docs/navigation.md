# Jarvis Home y módulos

Home → Finanzas conserva el dashboard existente. Home → Rutinas abre un
calendario mensual sin datos registrados. Ambos módulos permiten volver a Home
sin cerrar sesión.

`rutinas.js` separa el cálculo del mes, el estado efímero y el renderizado del
calendario. Usa fechas civiles locales, semanas de lunes a domingo y selecciona
hoy al comenzar. Al cambiar de mes conserva el número de día si existe, o el
último día del mes; «Mes actual» selecciona hoy. La selección se conserva al
volver a Home y se reinicia al descartar la identidad. No hay persistencia,
requests, formularios ni eventos demo. Los días son botones nativos con labels
completos, selección ARIA y borde; hoy se distingue con subrayado.

Los tipos visuales trabajo, entrenamiento, recuperación y evento personal están
reservados en el módulo/CSS. Cualquier futuro conjunto de bloques por fecha debe
permitir varios bloques de trabajo; esta etapa no define horarios, turnos
nocturnos, almacenamiento ni cálculos de sueño.

La PWA usa vistas internas, sin nuevas páginas HTML, frameworks ni aplicaciones.
Tras el flujo autorizado existente se muestra Home. La lectura financiera continúa
como antes; su carga y resultado se renderizan en la vista Finanzas, inicialmente
oculta. La finalización de la lectura no cambia la vista elegida por el usuario.

`navigation.js` contiene el catálogo visual de módulos y el cambio de vistas.
`app.js` conecta los eventos del flujo actual con esa navegación. `dashboard.js`
sigue siendo el renderizador financiero sin modificaciones. Nuevos módulos pueden
añadir su entrada y controlador de vista sin introducir lógica de negocio en app.js.

Home muestra bienvenida, Finanzas y Rutinas activos y Casa e Inversiones deshabilitados
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

Caché estática 2.3.9 incluye navigation.js. Se mantienen todas las exclusiones de
API, Authorization y no-store. Publicar conjuntamente los assets y activar la nueva
versión al desplegar posteriormente. No se cambian rutas, datos ni acceso a Sheets.
