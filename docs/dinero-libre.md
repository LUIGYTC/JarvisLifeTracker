# Dinero libre

Bloque independiente del dashboard principal de Finanzas, debajo de Dinero
disponible. No cambia esa métrica ni las de movimientos, crédito o MSI.

`GET /api/dinero-libre` conserva el middleware de autenticación por Google `sub`,
CORS y `no-store`. ADC de solo lectura hace un `values:batchGet` con rangos fijos:

- `TarjetasDebito!A:A` y `C:C`: reutiliza `aggregateAvailableMoney` sin cambios.
- `Compromisos!A:H`: reglas, método, estado y último pago. No lee notas/origen.
- `CortesTarjeta!A:E` y `H:M`: fechas y saldos reales; no lee componentes de MSI.
- `Movimientos!A:G`: detecta pagos que podrían faltar por conciliar; no expone
  registros, descripciones o métodos en la respuesta ni consulta texto original.

No escribe hojas. No lee `TarjetasCredito`, deuda utilizada, estimaciones de
Próximo corte ni ComprasMSI. La respuesta solo contiene importes, nombres del
desglose, periodo y motivos de información incompleta.

## Periodo y compromisos

`FORTNIGHT_ANCHOR` es una fecha ISO de inicio confirmada de una catorcena real,
configurada en el entorno del backend. Los periodos tienen 14 días inclusivos,
incluso antes de la fecha de referencia; la fecha actual usa Ciudad de México.
No hay fecha real predeterminada en el repositorio. `npm run dev` carga el archivo
local ignorado `backend/.env`; otros entornos deben proporcionar la variable.
Si falta o es inválida, se devuelve `estado: incompleto` y `dineroLibre: null`.

Las reglas mensuales `Día N` seleccionan la ocurrencia dentro de la catorcena
(ajustando al último día de meses cortos). No arrastran compromisos de periodos
anteriores. Una regla explícita `importe por catorcena` usa ese importe leído de
la hoja, sin convertir el mes en dos periodos de 14 días ni hardcodear cantidades.

`Último pago` dentro del mes de la ocurrencia —o de la catorcena para un apartado
catorcenal— excluye el compromiso ya liquidado. `Pagado` sin una fecha que
identifique el periodo no basta. Un registro simultáneamente `Pendiente` y con
último pago dentro del periodo requiere conciliación: no se supone pago completo.
Los duplicados, métodos desconocidos o de crédito, fechas aproximadas y estados
desconocidos hacen el cálculo incompleto.
Se admite el método explícito `Efectivo`. Un apartado de tipo `Ahorro` con importe
catorcenal explícito puede no tener método porque es una reserva interna; aun así
requiere conciliación si existen movimientos que podrían haber realizado el ahorro.

## Conciliación conservadora

Las hojas actuales no tienen identificadores que vinculen un movimiento con un
compromiso/corte. No se deduce un pago por coincidencias de importe, palabras en
la descripción o nombre de tarjeta. Si falta el último pago y existen gastos
registrados dentro del intervalo de pago, el compromiso requiere conciliación,
incluso si el movimiento fue en efectivo. Esto puede marcar un gasto no
relacionado como ambiguo: es deliberado para no descontar dos veces. La
automatización precisa de esa relación queda pendiente de un contrato confirmado.

Se admiten cortes reales `Cerrado`, `Pendiente`, `Parcial` o `Pagado`, con fechas
coherentes y `Total corte - Monto pagado = Saldo pendiente`. Se resta solo el saldo
pendiente, si vence hasta el fin de la catorcena; se incluyen cortes vencidos.
Los pagados con saldo cero no se restan. Los abiertos, estimados y proyectados se
excluyen. Sin filas de cortes no se inventa deuda exigible.

Un corte con saldo pendiente necesita fecha de actualización válida. Si hay
gastos registrados desde esa fecha, incluyendo el mismo día, podría existir un
pago aún no conciliado y no se publica un total definitivo. Dos cortes pendientes
de una misma tarjeta también requieren revisión porque el segundo puede arrastrar
el saldo del primero. No se suman como si fueran deudas independientes.

## Estados y privacidad

`completo` devuelve la resta en centavos seguros, incluyendo un resultado negativo.
`incompleto` mantiene el dato bruto, presenta los motivos y usa `null` para totales
sin determinar; nunca sustituye desconocidos por cero. El desglose parcial se
rotula explícitamente como confirmado y aún incompleto. Un fallo de Sheets o datos
malformados devuelve 503 genérico, con reintento en la interfaz.

Los datos solo viven en memoria/DOM; cerrar sesión cancela y limpia ambos bloques.
La caché estática `2.3.20` incluye el nuevo JS, nunca el endpoint privado.
Las pruebas usan datos sintéticos. Ejecutar la suite completa con
`node --test backend/test/*.test.js tests/*.test.cjs`, validar JS con `node --check`
y ejecutar `git diff --check`.
