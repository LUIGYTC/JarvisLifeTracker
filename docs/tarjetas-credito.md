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
pagos ni edición.

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

## Próximo corte dinámico

`GET /api/tarjetas-credito/proximo-corte?tarjeta=...` comparte autenticación, autorización
por sub, CORS y `no-store`. Valida la selección contra `TarjetasCredito!A:J`; solo el
servidor determina la fecha actual y los rangos. No admite fechas ni rangos del cliente.
Si falta un día de corte válido responde 422 sin inventar un periodo.

La fecha de referencia es el día civil en `America/Mexico_City`. El próximo corte es
el primero igual o posterior a hoy: el propio día de corte sigue en ese periodo.
Cada corte mensual se ajusta por separado al último día válido del mes si el día
configurado no existe. El periodo comienza al día siguiente del corte anterior y
termina en el corte actual; ambos extremos se incluyen. No hay cierres automáticos.

Compras normales: vuelve a leer `Movimientos!A:G` y suma todos los gastos válidos cuyo
Método coincide exactamente y Fecha pertenece al periodo. No usa la lista truncada
de movimientos recientes ni suma ingresos o el saldo Utilizado del snapshot.
MSI: reutiliza la lectura de `ComprasMSI!A:H`, tarjeta exacta y Estado Activo; suma
solo mensualidades cuyo Próximo corte normalizado coincide con la fecha calculada.
MSI sin fecha o con otro corte no se incluyen. No adelanta fechas ni parcialidades.

Devuelve `fechaCorte`, `inicioPeriodo`, `finPeriodo`, `comprasNormales`, `msi` y
`totalAcumulado`. Todas las sumas se validan en centavos enteros seguros. Las filas
inválidas relevantes o los errores de lectura producen un error genérico 503, sin
mostrar totales parciales. Una nueva consulta vuelve a leer las fuentes; no guarda
resultados. No usa CortesTarjeta, no crea hojas ni modifica movimientos, MSI o deuda.

La sección destacada «Próximo corte» presenta «Total acumulado», compras, MSI y periodo.
No representa un saldo cerrado ni un pago exigible. La carga es independiente de las
otras secciones y se cancela al volver o salir. No se persiste en el navegador ni en
la caché del service worker. La sección preexistente MSI activos conserva su listado
de todos los compromisos activos; el cálculo nuevo solo toma los del corte indicado.

## MSI activos

`GET /api/tarjetas-credito/msi?tarjeta=...` usa la misma autenticación, validación de
selección contra tarjetas existentes, CORS y `no-store`. Solo acepta un nombre de
tarjeta; no permite parámetros adicionales ni rangos del cliente. Tras validar la
tarjeta, lee exclusivamente `'ComprasMSI'!A:H` con ADC de solo lectura y valores
numéricos sin formato. No escribe ni consulta Movimientos para calcular los MSI.

Filtra por coincidencia exacta de Tarjeta y Estado `Activo`. Devuelve
`{ tarjeta, compras, totalMensualMSI }`; cada compra solo contiene `compra`,
`mensualidad`, `mesActual`, `mesesTotales` y `proximoCorte`. Nota no se devuelve ni
se registra en logs. Se suman centavos enteros seguros de todas las filas activas
de la tarjeta; no se agrupan ni excluyen compras según su próximo corte.

Mensualidad debe ser positiva, finita y tener como máximo dos decimales; se aceptan
números nativos o textos decimales con punto. Los meses son enteros seguros y cumplen
1 ≤ mesActual ≤ mesesTotales. Próximo corte admite fecha ISO, serial nativo o D/M/YYYY;
si está vacío devuelve null. Filas vacías y compras de otra tarjeta o estado se ignoran.
Una fila activa seleccionada inválida, encabezados incorrectos, más de 10 000 filas o
desbordamiento monetario producen un error genérico 503 para no mostrar un total
parcial engañoso. Sin MSI devuelve compras vacías y total cero.

El detalle muestra una sección separada «MSI activos» y el total como «Comprometido
en próximo corte», aclarando que son solo mensualidades MSI activas. No representa
saldo al corte ni pago para no generar intereses. La carga de MSI y movimientos es
independiente; los errores son genéricos y se puede reintentar. Ambas solicitudes se
abortan al volver o cerrar sesión; los resultados tardíos se descartan. Todo permanece
en memoria y el service worker excluye ambas APIs. No se avanzan mensualidades ni se
registran automáticamente gastos nuevos; las pruebas usan solo compras sintéticas.

Tarjetas y token permanecen únicamente en memoria. Cerrar sesión, descartar identidad,
salir o perder conexión aborta las lecturas, invalida respuestas tardías y limpia la
vista. Se omiten cookies; no se usa almacenamiento persistente. El service worker
solo almacena assets estáticos y excluye esta API. Las pruebas usan datos sintéticos;
no consultan ni modifican la hoja real.
