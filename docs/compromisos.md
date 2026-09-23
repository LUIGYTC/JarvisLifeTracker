# Procesamiento de compromisos

`POST /api/compromisos/procesar`, sin cuerpo ni parámetros, ejecuta el procesador
con la autenticación Bearer y autorización por Google sub existentes. Responde
con `Cache-Control: no-store`. No se invoca al abrir el dashboard y no instala
scheduler, cron ni automatizaciones externas. El cliente debe invocarlo
explícitamente; desplegar el código por sí solo no genera movimientos.

## Lectura y escritura

- ADC lee `Compromisos!A:H`, validando los encabezados actuales. No necesita
  `Nota` ni `Origen` del compromiso.
- Solo admite `Estado` exactamente `Activo`, importe numérico positivo con
  hasta dos decimales, método no vacío y fecha confirmada vencida o de hoy.
  Usa el día civil de `America/Mexico_City`.
- Excluye `Regla operativa` y `Pago de tarjetas`, sin interpretar sus notas.
- Admite `Mensual`, `Diario`, `Semanal` y `Catorcenal`. Otras frecuencias quedan
  como `no_procesable`; no se infieren reglas.
- Genera una fila RAW en `Movimientos!A:J` mediante el escritor existente:
  fecha programada, hora `00:00` (no representa hora bancaria), `Gasto`,
  `Servicios`, monto, nombre, método original, destino vacío, `Jarvis` y texto
  de procedencia con referencia determinista. No hay importes ni nombres
  particulares configurados en el procesador. Se usa `Servicios` porque el
  esquema no define una categoría estable por compromiso.
- No recalcula saldos ni modifica `Cuentas`, `TarjetasCredito`, MSI o cortes.
  El método original permite que actúen las fórmulas existentes del Sheet.
- Tras confirmar el movimiento, escribe únicamente E (`Próxima fecha de pago`)
  y H (`Último pago`) como fechas seriales RAW conservando el formato de celda.
  `Último pago` guarda la fecha programada procesada, no la fecha de ejecución.
  Comprueba antes que esas celdas no contengan fórmulas; si las contienen,
  reporta `fecha_con_formula` sin crear el movimiento.
- Mensual conserva el día, limitándolo al último día del mes cuando hace falta.
  Usa la fecha programada anterior de `Último pago` para recuperar el día tras
  un mes corto (31 de enero → 28/29 de febrero → 31 de marzo).
- Procesa vencimientos atrasados en orden por compromiso, hasta 50 ocurrencias
  por llamada. `limiteAlcanzado` y `pendiente / limite_ejecucion` indican que
  hace falta otra invocación. Cada vencimiento conserva su fecha histórica.

## Idempotencia y recuperación

La identidad es un hash de spreadsheet + nombre normalizado + fecha programada,
con formato UUID compatible con el escritor existente. Reutiliza el registro
persistente `Operaciones`; no requiere columnas nuevas ni almacenamiento en el
navegador. Los nombres deben ser únicos y estables. Rechaza nombres duplicados,
incluso con diferencias de espacios o mayúsculas.

Un movimiento `registered` nunca se vuelve a insertar. Si falla la actualización
de fechas, devuelve `movimiento_registrado_fechas_pendientes`; otra llamada puede
completarla y devolver `recuperado`. Si el escritor deja una operación `pending`
por un resultado incierto, devuelve `operacion_pendiente_revision` en el siguiente
intento: requiere revisar el Sheet; no vence la reserva ni reintenta el cargo.
No se debe borrar una reserva pendiente para forzar un reintento sin conciliarla.

El procesador bloquea llamadas simultáneas dentro de la misma instancia (HTTP
409). Entre instancias conserva las garantías y limitaciones del escritor
existente descritas en [movimientos-idempotency.md](movimientos-idempotency.md):
Sheets no proporciona compare-and-swap ni una transacción conjunta entre el
movimiento, el registro de operaciones y las fechas. No se promete exactamente
una ejecución ante cualquier carrera distribuida. Evitar ejecuciones simultáneas
y ediciones manuales durante el procesamiento. Relee los datos y localiza de
nuevo la fila antes de escribir fechas, pero esto no equivale a un bloqueo del Sheet.

No renombrar compromisos ni modificar fechas históricas o borrar `Operaciones`
para repetir una ocurrencia: eso cambia o elimina su identidad de deduplicación.
Los movimientos manuales previos no tienen esa identidad y no se concilian por
similitud de descripción. Antes de la primera ejecución, actualizar las próximas
fechas de compromisos ya registrados manualmente. Si `Último pago` ya es igual
o posterior a la próxima fecha, se reporta inconsistencia sin registrar gasto.

## Respuesta y alcance

HTTP 200 devuelve `{ fecha, limiteAlcanzado, resultados }`; cada resultado contiene
el nombre y un estado (`procesado`, `recuperado`, `omitido`, `no_procesable` o
`pendiente`), más fechas o motivo según corresponda. Un 200 no implica que todos
los compromisos fueran procesables. Los errores globales de lectura responden
503 `commitments_unavailable`, sin detalles de proveedor o credenciales.

Esto registra gastos programados según las reglas configuradas; no confirma un
cargo real, no cobra al banco, no paga tarjetas y no envía notificaciones. Las
pruebas usan un Sheet simulado con el escritor real; no ejecutan compromisos ni
modifican datos financieros reales.
