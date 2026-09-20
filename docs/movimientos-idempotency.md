# Registro estructurado e idempotencia

POST /api/movimientos conserva la autenticación, autorización, CORS y no-store
existentes. Exige los nueve campos financieros originales y `operationId`, UUID v4
con variante RFC 4122. Mayúsculas y minúsculas representan la misma operación.
El servidor normaliza solo el UUID a minúsculas; no modifica los textos ni el monto.
Campos adicionales, UUID ausente/incorrecto o payload inválido: 400 sin acceso de
escritura. La validación financiera también se aplica a solicitudes duplicadas.

Cada operación lógica debe conservar el mismo UUID en todos sus reintentos.
No generar otro UUID para resolver un error. El cliente futuro puede generar uno
con crypto.randomUUID(); esto no cambia la regla de tokens solo en memoria.
No hay formulario, IA ni interfaz de escritura en esta versión.

## Contrato y límites

Content-Type application/json, opcional charset=utf-8; sin compresión. Máximo
16 KiB y 5 segundos de lectura. Fecha real YYYY-MM-DD (0001–9999), hora HH:MM
(00:00–23:59), tipo Gasto/Ingreso, monto number finito > 0 sin coerción ni redondeo.
categoria/metodo/origen: 1–100 unidades UTF-16; descripcion: 1–500;
textoOriginal: 1–2000. Todos los textos deben contener algo distinto de espacios.
Se preservan los caracteres originales, incluidos prefijos de fórmulas.

La escritura financiera sigue usando values.append, INSERT_ROWS y
valueInputOption=RAW en el spreadsheet fijo y `'Movimientos'!A:I`, exactamente
Fecha, Hora, Tipo, Categoría, Monto, Descripción, Método, Origen, Texto original.
No se añade operationId a Movimientos ni se alteran sus columnas.

## Algoritmo persistente

1. Después de autorizar y validar, descubrir Operaciones por nombre en metadata.
   Si falta, crear una hoja oculta de tres columnas. Una colisión o resultado
   incierto al crear devuelve error sin escribir movimientos; no se repite la creación.
2. Leer Operaciones A:C y buscar la primera fila con ese UUID. Las columnas son
   A operationId, B timestamp UTC ISO, C estado. No hay cabecera generada: la primera
   fila puede ser una operación. No contiene token ni copia/hash de datos financieros.
3. Si existe con estado registered: 200 {"registered":true,"duplicate":true}.
   Si existe con pending o estado desconocido: 409 {"error":"operation_pending"}.
4. Si no existe, añadir una reserva RAW [UUID,timestamp,pending] mediante append.
   Conservar el número de fila que confirmó Sheets. Si se pierde esa respuesta,
   terminar sin escribir en Movimientos.
5. Volver a leer el registro. Solo la petición cuya reserva sea la primera fila
   para ese UUID puede continuar. Esto resuelve carreras habituales entre instancias
   que leyeron simultáneamente que no existía. Puede dejar reservas redundantes;
   siempre manda la primera. Una reserva posterior no puede tomar el relevo.
6. Añadir una sola fila RAW A:I y exigir confirmación de una fila y nueve celdas
   en ese rango. No se reintenta automáticamente ninguna llamada de escritura.
7. Actualizar únicamente C de la reserva ganadora a registered, exigir confirmación
   de una celda y responder 200 {"registered":true}.

El plazo global es 20 segundos, incluida la obtención ADC. Errores externos o
respuestas inesperadas devuelven 503 {"error":"movement_unavailable"}, sin detalles
del proveedor. Las operaciones pendientes no caducan ni se liberan automáticamente.
Un UUID registrado con otro payload válido sigue devolviendo duplicate:true:
no se compara contenido, no se sustituye el movimiento original.

## Pérdidas de respuesta y recuperación

- Confirmación final aplicada pero respuesta perdida: el siguiente POST con el
  mismo UUID encuentra registered y no inserta otra fila.
- Reserva aplicada pero respuesta perdida: queda pending y no se escribe el movimiento.
- Append financiero aplicado pero respuesta perdida, o caída antes de marcar
  registered: queda pending; el siguiente POST devuelve 409 sin otra inserción.
- Fallo antes del append financiero: también puede dejar pending. Se prioriza no
  duplicar sobre completar automáticamente una operación.

Un 409 no confirma registro ni ausencia de registro. Requiere reconciliación manual
por el propietario: esperar a que no existan solicitudes en vuelo y revisar ambas
hojas. No borrar reservas ni inventar otro UUID mientras el resultado sea incierto.
No hay endpoint de recuperación automática en esta fase. Si no puede determinarse
el resultado, conservar pending y no volver a escribir.

## Límites de atomicidad y operación

Sheets no ofrece compare-and-set ni una restricción UNIQUE para este flujo de
values.append RAW. Consulta, reserva, append financiero y confirmación son llamadas
separadas, no una transacción. La elección por primera fila depende de la visibilidad
de las escrituras completadas y de que el registro no cambie de orden. No es un lock
distribuido formal y **no se promete exactly-once**. Los tests simulan consistencia
de lecturas tras append; no demuestran una garantía distribuida de Google.

Antes de desplegar, revisar esta limitación y la reconciliación manual. Configurar
un único escritor con concurrencia 1 reduce exposición, pero no sustituye una
garantía transaccional ni elimina posibles solapamientos durante despliegues.
No ordenar, insertar/borrar filas, renombrar ni editar Operaciones mientras haya
solicitudes; ocultarla no es control de acceso. No ejecutar otras aplicaciones que
escriban movimientos sin este protocolo. El registro debe conservarse al reiniciar
o restaurar el servicio. Borrarlo permite repetir operaciones anteriores.

Leer todo A:C es lineal y consume cuota: revisar crecimiento y latencia antes de
uso intensivo. No se lee contenido financiero para deduplicar. Las filas antiguas
creadas sin UUID no quedan protegidas retroactivamente. Eliminar el botón viejo
requiere activar la actualización PWA 2.3.5; el backend rechaza su payload sin UUID.

Referencias: [append](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets.values/append),
[batchUpdate y límites entre llamadas](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/batchUpdate).
