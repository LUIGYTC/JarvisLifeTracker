# Vista general de tarjetas de crédito

`GET /api/tarjetas-credito` comparte Google ID token, autorización por `sub`, CORS y
`Cache-Control: no-store` con las otras APIs privadas. No admite parámetros ni cuerpo.
La lectura ADC usa el spreadsheet configurado y exclusivamente `'TarjetasCredito'!A:J`,
scope `spreadsheets.readonly`, método GET y timeout de 8 segundos. No escribe en Sheets.

Respuesta: `{ tarjetas: [...] }`. Cada elemento incluye únicamente `tarjeta`, `tipo`,
`limite`, `utilizado`, `disponible`, `porcentajeUtilizacion`, `diaCorte`,
`ultimaActualizacion`, `fechaLimitePago` y `domiciliadaA`. No se leen columnas adicionales.

Se solicitan valores sin formato (`UNFORMATTED_VALUE`) para obtener números nativos y
resultados de fórmulas, no fórmulas ni importes formateados. Importes finitos con máximo
dos decimales y centavos enteros seguros; se admiten también textos decimales con punto,
agrupación de miles por coma válida y prefijo `$` o `MXN`. Límite y utilizado deben ser
no negativos; disponible admite saldo negativo cuando se excede el límite.

Los porcentajes numéricos de Sheets son proporciones: 0.25 equivale a 25%. Un texto
explícito `25%` también se normaliza a 25. La API devuelve puntos porcentuales con hasta
dos decimales y admite utilización superior a 100%. No recalcula saldos ni cortes.

Las fechas admiten serial nativo de Sheets, ISO `YYYY-MM-DD` o texto `D/M/YYYY` y se
normalizan a ISO; la actualización conserva solo la fecha. Corte: entero de 1 a 31.
Corte, actualización, fecha límite y domiciliación vacíos se devuelven como `null`.
Una fila inválida se omite sin registrar su contenido ni afectar las filas válidas.
Encabezados incorrectos o más de 10 000 filas de datos producen error genérico.
Una hoja sin datos o sin filas válidas devuelve una lista vacía.

La sección se carga al abrir «Tarjetas de crédito» en Finanzas. La dona representa
solo saldos utilizados; los límites no determinan los segmentos. La leyenda incluye
importe y participación de cada tarjeta. Sin deuda, se muestra una dona neutra.
Las cards abren el detalle de la tarjeta mediante clic, tap, Enter o espacio.
El detalle usa los datos ya cargados y llama «Saldo actual» al campo `utilizado`.
Muestra tipo, utilización, disponible, límite, corte, fechas y domiciliación registrada.
Volver a «Tarjetas de crédito» restaura la vista general en memoria sin otra lectura
ni autenticación. No se incluyen cortes históricos, próximo pago, saldo al corte,
MSI, pagos ni edición.

`GET /api/tarjetas-credito/movimientos?tarjeta=...` acepta exactamente un nombre de
tarjeta, con máximo 100 caracteres. Después de autenticar y autorizar, valida el
nombre contra `TarjetasCredito!A:J`. Una selección inexistente devuelve 404;
parámetros adicionales, duplicados o vacíos devuelven 400. No admite rangos del cliente.
Lee exclusivamente `Movimientos!A:G` con ADC y la validación existente del dashboard.
Filtra por coincidencia exacta de `Método` antes de ordenar por fecha/hora descendente
y limitar a 10. No usa la lista global de 20 movimientos recientes del dashboard.
Devuelve `{ tarjeta, movimientos }`, con fecha, descripción, categoría, monto y tipo
en cada movimiento; no devuelve Origen, Texto original ni otras columnas.
Errores de lectura devuelven un error genérico 503. El detalle conserva los datos de
la tarjeta y permite reintentar la lectura de movimientos. Volver, seleccionar otra
tarjeta o cerrar sesión aborta la lectura e invalida las respuestas tardías.

Tarjetas y token permanecen únicamente en memoria. Cerrar sesión, descartar identidad,
salir o perder conexión aborta las lecturas, invalida respuestas tardías y limpia la
vista. Se omiten cookies; no se usa almacenamiento persistente. El service worker
solo almacena assets estáticos y excluye esta API. Las pruebas usan datos sintéticos;
no consultan ni modifican la hoja real.
