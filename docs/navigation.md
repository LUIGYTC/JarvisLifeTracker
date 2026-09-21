# Jarvis Home y módulos

Home → Finanzas conserva el dashboard existente. Home → Rutinas abre un
calendario mensual con lectura autenticada de Turnos. Ambos módulos permiten volver a Home
sin cerrar sesión.

`rutinas.js` separa el cálculo del mes, el estado efímero y el renderizado del
calendario. Usa fechas civiles locales, semanas de lunes a domingo y selecciona
hoy al comenzar. Al cambiar de mes conserva el número de día si existe, o el
último día del mes; «Mes actual» selecciona hoy. La selección se conserva al
volver a Home y se reinicia al descartar la identidad. No hay persistencia,
formularios ni eventos demo; los turnos se consultan por mes. Los días son botones nativos con labels
completos, selección ARIA y borde; hoy se distingue con subrayado.

Los tipos visuales trabajo, entrenamiento, recuperación y evento personal están
reservados en el módulo/CSS. Cualquier futuro conjunto de bloques por fecha debe
permitir varios bloques de trabajo. La semántica de los turnos nocturnos y las
limitaciones de esta lectura se describen en [turnos.md](turnos.md).

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

La autorización no cambia. El ID token se mantiene únicamente en el closure de
autenticación durante la sesión de página para consultar Turnos al cambiar de mes.
Se descarta al salir, perder conexión, iniciar otro login o recibir 401/403 en
Turnos. La navegación conserva el dashboard en memoria sin persistir identidad.

Caché estática 2.3.10 incluye navigation.js y rutinas.js. Se mantienen las exclusiones de
API, Authorization y no-store. Publicar conjuntamente los assets y activar la nueva
versión al desplegar posteriormente. Finanzas conserva su fuente y funcionamiento.
