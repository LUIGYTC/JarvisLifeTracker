# Gastos con tarjetas

Vista global de compras registradas con las tarjetas existentes. El periodo es el
mes calendario actual hasta hoy, ambos extremos incluidos, según America/Mexico_City.
Se calcula una vez al iniciar cada consulta y se muestra con fechas completas.
Esta decisión es explícita: Movimientos muestra todo el historial y cada tarjeta
tiene su propio periodo de corte; ninguno de esos periodos se modifica ni se mezcla.

GET /api/gastos-tarjetas no acepta parámetros. Mantiene verificación de identidad,
autorización por Google sub, CORS y Cache-Control: no-store existentes. Con ADC y
acceso de solo lectura consulta los rangos fijos TarjetasCredito!A:K y Movimientos!A:H
del spreadsheet configurado. Incluye Tipo=Gasto y Método exactamente igual a un
nombre de tarjeta existente, con Fecha dentro del periodo. Las tarjetas nuevas se
incorporan en la siguiente consulta. No lee MSI ni CortesTarjeta ni escribe datos.

Respuesta: inicioPeriodo, finPeriodo, total, numeroCompras y categorias (categoria,
total, porcentaje), ordenadas de mayor a menor gasto. Los importes se acumulan en
centavos enteros seguros usando la validación existente de Movimientos. No utiliza
la lista truncada de movimientos recientes. Los porcentajes se calculan sobre el
total sin redondear en backend; la interfaz muestra un decimal como máximo.
Las filas vacías se ignoran. Datos inválidos relevantes producen un error genérico,
sin presentar totales parciales. No devuelve descripciones, métodos, notas ni datos
del snapshot de tarjetas. Los rangos originales excluyen Origen y Texto original.

La interfaz solicita datos al entrar en la vista y permite reintentar errores.
Los datos permanecen solo en memoria/DOM; descartar la identidad aborta peticiones,
limpia la vista e invalida respuestas tardías. No se usan almacenamiento del
navegador ni cookies. El service worker solo permite assets estáticos, incluida la
nueva vista, y no intercepta la API privada. Caché del frontend: 2.3.18.

Dos métricas superiores y donut con leyenda completa. En escritorio, las cinco
categorías principales quedan a la derecha; en móvil, debajo. Las barras son
proporcionales a la categoría de mayor gasto. La paleta se asigna por posición en
el listado ordenado y se comparte entre donut, leyenda y barras; no interviene en
ningún cálculo. Los iconos SVG son de presentación, con alternativa genérica para
categorías desconocidas. No hay dependencias nuevas, filtros ni desglose por tarjeta.

Las pruebas usan exclusivamente datos sintéticos. La revisión visual también se
realiza con datos sintéticos, sin consultar ni modificar Google Sheets reales.
