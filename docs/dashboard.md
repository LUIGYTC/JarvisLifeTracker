# Dashboard de solo lectura

GET /api/dashboard usa la misma verificación Google ID token y autorización por sub
que /auth/me. CORS y Cache-Control: no-store se mantienen. No admite query parameters
para elegir hoja, rango o spreadsheet: esas URLs no corresponden a una ruta válida.

La única fuente está en DASHBOARD_RANGE de backend/src/dashboard.js:
`'Movimientos'!A:H`. Usa ADC con scope spreadsheets.readonly y solo GET.
No consulta MovimientosDemo ni invoca las rutas de escritura. Las columnas I Origen y
J Texto original no se solicitan a Google y no aparecen en la respuesta.
El backend de escritura preexistente permanece intacto; el frontend no lo invoca.

## Respuesta

- summary: ingresos, gastos, balance, movimientos; números, sin formato monetario.
- byCategory: categoria y total, exclusivamente gastos; mayor total primero.
- byPaymentMethod: metodo y total, exclusivamente gastos; mayor total primero.
- daily: fecha, ingresos, gastos; fechas con Gasto o Ingreso en orden ascendente.
- recent: hasta 20 movimientos, fecha+hora descendente. Solo fecha, hora, tipo,
  categoria, monto, descripcion, metodo y destino.

El periodo es todo el contenido válido de la hoja, no solo el mes actual.
Se suman centavos enteros seguros; Ingreso suma a ingresos, Gasto a gastos y balance
es ingresos menos gastos. Transferencia y Pago tarjeta solo aparecen en el conteo y listado reciente, nunca en gastos/ingresos ni en sus agrupaciones. Para ellos Destino es obligatorio y distinto de Método; la categoría puede estar vacía. No se redondean importes con más de dos decimales.
Las agrupaciones conservan las etiquetas originales para no fusionar categorías
con significados potencialmente distintos. Los empates recientes conservan el
orden de las filas originales.

## Formato de origen y errores

Se ignoran filas vacías, incluso solo espacios. La primera fila no vacía debe
contener Fecha, Hora, Tipo, Categoría, Monto, Descripción, Método, Destino en ese orden.
Se admiten fechas ISO YYYY-MM-DD o fechas nativas de Sheets como serial entero;
horas HH:MM o serial de hora con precisión de minutos. Fechas locales ambiguas
como 01/02/2026 no se interpretan automáticamente. Tipos exactos: Gasto, Ingreso, Transferencia y Pago tarjeta.
Monto debe ser una celda numérica positiva y finita, con máximo dos decimales.
No se convierten strings monetarios como "$1,000". Categoría/método: hasta 100
unidades UTF-16; descripción: hasta 500, no vacíos.

La lectura usa valueRenderOption=UNFORMATTED_VALUE para leer valores evaluados. No modifica fórmulas ni las devuelve al navegador. Una fila inválida produce un error genérico para evitar totales engañosos.
Hoja vacía devuelve ceros y arrays vacíos. Límite: 10 000 filas de datos; excederlo
produce error, no truncamiento silencioso. Timeout backend: 8 segundos.

## Flujo frontend y privacidad

/auth/me → /api/sheets/status conectado → /api/dashboard, usando el mismo ID token
solo en memoria. Se descarta al terminar. Descartar identidad, salir, perder conexión
o abrir la exploración pública aborta la petición e invalida respuestas tardías y
elimina la información renderizada. No hay almacenamiento financiero persistente.
La UI muestra carga, datos cargados, sin movimientos o «No pudimos cargar tus datos.».
El usuario puede volver a iniciar sesión para solicitar una nueva lectura.

Las tres gráficas de barras usan HTML/CSS y valores accesibles, sin dependencias:
gastos por categoría, ingresos/gastos diarios y gastos por método. Importes MXN con
Intl.NumberFormat('es-MX'). Los textos se escapan antes de insertarlos como HTML.
Se muestra «Tus movimientos». El acceso público no contiene datos financieros
hardcodeados y no solicita información privada. Cache PWA 2.3.21 solo incluye assets;
no intercepta API, Authorization ni no-store.

## Antes de desplegar

Confirmar encabezados y tipos de celdas de Movimientos.
Las pruebas usan datos sintéticos; se verificaron encabezados del Sheet sin modificarlo.
Verificar en Cloud Run autenticación, acceso ADC y resultado vacío/con datos desde
la PWA después de publicar conjuntamente los assets y activar la nueva caché.
Revisar volumen/cuotas de lectura antes de crecer más allá del límite definido.
La futura selección de otra fuente requiere cambiar la constante server-side y
revisar permisos; el contrato del frontend no cambia.
