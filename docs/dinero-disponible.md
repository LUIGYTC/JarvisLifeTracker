# Dinero disponible

El dashboard principal de Finanzas muestra el total y el desglose de cuentas de
débito en una tarjeta independiente de Movimientos. Se vuelve a consultar al abrir
Finanzas o regresar a su vista principal, y permite reintentar si falla la lectura.

`GET /api/dinero-disponible` usa la autenticación y autorización por Google `sub`
existentes, ADC de solo lectura, CORS existente y `Cache-Control: no-store`.
Consulta exclusivamente `Cuentas!A:A` (`Cuenta`), `Cuentas!E:E` (`Saldo disponible / valor actual`) y `Cuentas!C:C` (`Tipo`) mediante una sola operación `values:batchGet`, con valores
evaluados sin formato. No consulta otras hojas ni devuelve banco, notas o fechas.

Respuesta: `{ total, cuentas: [{ nombre, saldo }] }`. Solo incluye tipos Débito y Cuenta remunerada; excluye Inversión sin depender del nombre de cuenta. Un tipo desconocido produce error, evitando un total parcial. No usa Saldo base ni recalcula saldos. La suma se realiza en
centavos seguros; incluye cuentas nuevas, saldos cero y saldos negativos tal como
están registrados, sin agrupar ni filtrar por nombre. Las filas vacías se omiten.
Una fila poblada inválida o un encabezado inesperado produce un error genérico,
en lugar de mostrar un total parcial. Un dataset vacío devuelve cero y ninguna
cuenta. La interfaz distingue entre ese estado y un error de lectura.

Las cuentas de tipo Inversión se devuelven en el campo adicional `otrasCuentas`,
con nombre, saldo evaluado y tipo. Se muestran separadas como valor actual de
inversiones, fuera del total líquido; no se omiten del dashboard ni se suman a
Dinero disponible. El campo se omite si no hay cuentas de inversión.

Todas las cuentas usan un SVG bancario genérico, independiente del cálculo.
Los nombres se escapan para HTML y pueden ajustarse a varias líneas. En pantallas
estrechas el importe se sitúa debajo del nombre cuando es necesario.
Los datos permanecen solamente en memoria/DOM durante la sesión; cerrar sesión
limpia la tarjeta y cancela solicitudes. El service worker almacena únicamente
archivos estáticos, incluyendo el nuevo módulo, con versión `2.3.21`.

Validación: `node --test backend/test/*.test.js tests/*.test.cjs`, `node --check`
para JavaScript y `git diff --check`. Todos los datos de prueba son sintéticos.
