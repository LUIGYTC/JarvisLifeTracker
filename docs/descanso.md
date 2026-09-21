# v0.3.2 — Sueño y Recuperación

`descanso.js` es un motor puro: recibe turnos normalizados y configuración,
devuelve recomendaciones y no usa DOM, red ni almacenamiento. CONFIG centraliza
preparacionHoras=1, trasladoHoras=1, minimoHoras=6 e idealHoras=8. Son valores
iniciales del usuario, no umbrales médicos; podrán convertirse en preferencias.

## Reglas

Ordenar por inicioReal físico, no Fecha turno. Para cada bloque:

- Despertar objetivo = inicioReal menos preparación y traslado.
- Inicio ideal = despertar menos 8 h; límite para 6 h = despertar menos 6 h.
- Inicio disponible = máximo entre inicio ideal y el mayor finReal de todos los
  bloques anteriores. Esto conserva el límite correcto incluso con solapamientos.
- Si hay 8 h disponibles: ideal. Entre 6 h y menos de 8: reducido. Menos de 6:
  recuperacion_prioritaria. Sin espacio positivo, ventana=null. Si no caben 6 h,
  limiteMinimo=null; no se propone una hora mínima incompatible con el trabajo.

Cada recomendación incluye index original, fechaTurno, inicioTrabajo, despertar,
objetivoHoras, minimoHoras, estado, ventana {inicio,fin} o null y limiteMinimo o
null. Se conservan todos los bloques, incluyendo tentativos como obligaciones
posibles. No se suman las ventanas para afirmar horas dormidas. Días sin bloque
operativo no tienen una hora fija: la recomendación pertenece al bloque que la
motiva y puede comenzar el día anterior.

Para trabajo 08–16, despertar 06:00, ideal 22:00 del día anterior y límite para
6 h a las 00:00, siempre sujeto al trabajo previo. Para 07–15, despertar 05:00,
ideal 21:00 y límite 23:00 del día anterior. Un nocturno usa exactamente los
inicioReal/finReal entregados por v0.3.1, sin reconstruirlos desde Fecha turno.

La aritmética usa una coordenada de calendario UTC internamente para evitar que
la zona del navegador modifique horas civiles. La entrada y salida siguen sin
Z/offset: no se han convertido en instantes reales ni decidido una zona horaria.
Timestamps inválidos impiden calcular descanso, conservando la vista de Turnos.

## Contexto y presentación

El calendario pide dos días operativos antes y después del mes visible. Como el
contrato de Turnos produce bloques de hasta 24 horas y puede iniciar un nocturno
el día anterior, este margen cubre los objetivos actuales y las transiciones de
los bordes. Máximo 35 días por petición, dentro del límite de 62. Al ampliar
preferencias o permitir bloques de más de 24 h habrá que revisar el margen.
La API y su validación no cambian. Solo se dibujan celdas del mes visible.

Las celdas conservan turnos como contenido principal. Un indicador discreto
☾ / ☾− / ☾! indica ideal/reducido/prioritario con label accesible; el detalle
muestra el estado completo y fechas explícitas en cada extremo de la ventana.
Es sueño recomendado, nunca sueño registrado. Si hay varios bloques, se explica
el descanso antes de cada uno; la celda indica la clasificación más restrictiva.

## Limitaciones y seguridad

No registra sueño, no diagnostica, no programa ejercicio y no optimiza siestas
ni combina ventanas. El tiempo libre se calcula solo entre obligaciones laborales
conocidas y la preparación/traslado previos; no incorpora traslado de regreso,
comidas, otras obligaciones ni margen para conciliar el sueño. Los solapamientos
pueden hacer inviable incluso el despertar objetivo, que se muestra como objetivo
teórico junto a la advertencia de falta de espacio. No se presume que una persona
haya dormido menos de 6 h cuando la clasificación es prioritaria.

Las filas omitidas por la validación de Turnos no se conocen en frontend: las
recomendaciones dependen de la integridad de esa fuente y no garantizan descanso.
El futuro motor de ejercicio deberá decidir zona/DST, obligaciones adicionales,
tratamiento configurable de tentativos y posibles ventanas alternativas antes
de reutilizar estos resultados como restricciones definitivas.

Todo se deriva en memoria y se limpia con la sesión, cambios de mes y errores.
No hay hoja Sueño, escrituras a Sheets, API nueva ni persistencia de navegador.
Autenticación y CORS sin cambios. Caché estática 2.3.11 incluye descanso.js;
las respuestas privadas siguen excluidas. No se consultaron datos reales.
