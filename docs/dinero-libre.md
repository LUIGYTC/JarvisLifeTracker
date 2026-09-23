# Dinero libre: compatibilidad con el Sheet actual

`GET /api/dinero-libre` mantiene su ruta, autenticación, ADC, CORS y no-store.
La lectura sigue siendo un único `values:batchGet` de rangos fijos:

- `Cuentas!A:A`, `E:E` y `C:C`: nombre, saldo evaluado y tipo. Reutiliza la suma
  de Dinero disponible: Débito y Cuenta remunerada; Inversión queda fuera.
- `Compromisos!A:H`: incluye el encabezado actual Próxima fecha de pago.
- `CortesTarjeta!A:E` y `H:M`: cortes históricos cerrados y sus saldos registrados.
- `Movimientos!A:H`: incluye Destino y los cuatro tipos actuales.

No se recalculan saldos de cuentas o tarjetas ni se escriben fórmulas.
No se consultan TarjetasCredito o ComprasMSI para inventar deuda exigible.

## Compromisos solo informativos

Esta fase reemplaza la interpretación anterior de reglas recurrentes. Se leen y
muestran nombre, tipo, importe, frecuencia, próxima fecha, método y estado en
`compromisosInformativos`. No se generan vencimientos, apartados ni pagos.
El desglose descontado `compromisos` permanece vacío. Cuando existen compromisos,
`compromisosApartados` y `dineroLibre` son `null`, estado `incompleto`, con el motivo
`compromisos_solo_lectura`. No se presenta como dinero libre un importe que omita
reservas aún no implementadas. Los contratos existentes conservan sus campos;
el listado informativo es una extensión de la respuesta.

## Cortes y movimientos

Se conserva la lógica de cortes reales: total menos pagado debe coincidir con el
saldo pendiente registrado; los saldos cero no se restan. Se incluyen los que
vencen hasta el final de la catorcena y los vencidos, sin estimar cortes futuros.
La referencia de catorcena sigue configurada con `FORTNIGHT_ANCHOR`; si falta,
el periodo queda incompleto. No es un scheduler ni produce escrituras.

Un movimiento `Pago tarjeta` se vincula a la tarjeta mediante `Destino`. Si es
posterior a la última actualización del corte (incluyendo el mismo día), requiere
conciliación para no descontarlo dos veces. No se infieren pagos de descripciones
libres ni se tratan `Gasto` o `Transferencia` como pagos de tarjeta.
Los cortes duplicados o con posible arrastre siguen requiriendo conciliación.

La UI distingue datos informativos, descuentos confirmados y totales desconocidos.
Cerrar sesión limpia el contenido; no hay persistencia financiera en el navegador.
La caché `2.3.21` solo incluye archivos estáticos y excluye las APIs privadas.
