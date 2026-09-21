# v0.3.1 — Turnos

GET /api/turnos?from=YYYY-MM-DD&to=YYYY-MM-DD comparte el verificador y la
autorización de las demás APIs privadas: 401 sin identidad válida y 403 para
usuario no autorizado. Exige ambos parámetros una sola vez, fechas reales,
orden ascendente y un máximo de 62 días inclusivos. Parámetros adicionales se
rechazan con 400. Errores de Sheets responden 503 con turnos_unavailable.

Respuesta 200: `{ "turnos": [] }` o un array con objetos que contienen exactamente
`fechaTurno`, `horaInicio`, `horaFin`, `tipo`, `estado`, `nota`, `inicioReal` y
`finReal`. Todos son strings; fechaTurno usa YYYY-MM-DD, horas HH:MM y timestamps
YYYY-MM-DDTHH:MM:00 sin offset. No devuelve Origen ni Texto original.

El backend usa ADC con scope de lectura y rango fijo `'Turnos'!A:F`. No acepta
spreadsheet ni rango A1 del cliente. Lee las columnas completas y filtra por
fecha en servidor; Sheets no ofrece este filtro de valores mediante A1. No
escribe ni modifica encabezados. Se admiten fechas/horas literales estrictas y
seriales de Sheets. FORMULA permite detectar y omitir fórmulas en vez de evaluar
su resultado como un dato del turno.

Se ignoran filas vacías y filas inválidas, sin registrar su contenido. Tipo y
estado deben ser textos no vacíos (máximos 100 y 50 caracteres); nota es opcional
(máximo 500). No se limita estado a dos valores; Confirmado y Tentativo tienen
representación textual y Tentativo subrayado discontinuo. Encabezados incorrectos
o más de 10.000 filas de datos generan error global. Una respuesta vacía puede
significar que no existen filas válidas: esta versión no informa cuántas omitió.

## Día operativo y medianoche

Fecha turno es el día operativo, no necesariamente la fecha de inicio físico.
Si horaFin <= horaInicio, inicioReal usa el día anterior y finReal usa Fecha
turno. Esto incluye horas iguales como bloque de 24 horas según el contrato.
Por ejemplo sintético: un 23–07 con fecha operativa 2032-03-01 comienza el
2032-02-29 a las 23:00 y termina el 2032-03-01 a las 07:00. Se muestra el 1 de
marzo. Los turnos diurnos empiezan y terminan en Fecha turno. Nunca se fusionan
los bloques que comparten fecha. El cálculo se hace exclusivamente en backend.

Los timestamps representan horas civiles sin zona. No se ha definido una política
de zona horaria/DST ni cálculo de duración para sueño o entrenamiento. Esas
decisiones quedan pendientes para el futuro motor; no inferir instantes UTC.

## Calendario y privacidad

Rutinas consulta al abrirse y al cambiar el mes. Reabrir el mismo mes cargado o
pendiente no duplica la petición. Cambiar de mes aborta la anterior y descarta
respuestas atrasadas. Solo conserva el mes actual en memoria. Para refrescar
tras editar manualmente Sheets se puede cambiar de mes y regresar. Tras un error,
reabrir Rutinas permite otro intento; no hay reintentos automáticos.

Las celdas muestran un horario compacto y +N para bloques adicionales. El detalle
muestra cada bloque, estado y nota escapados como texto. Seleccionar días o navegar
sigue funcionando durante errores. La demo pública no recibe el lector privado.

El ID token permanece en el closure de auth.js durante la sesión de página para
las consultas posteriores. No se expone a los módulos ni se decodifica/persiste.
Cada request se verifica en backend. Logout, descarte, nuevo login, offline y
pagehide eliminan identidad y turnos y abortan lecturas. Un 401/403 en Turnos
descarta la sesión y solicita Google otra vez; no hay refresh automático.
Se usan credentials:omit, redirect:error, no-store y timeout de 12 segundos.
El backend aplica timeout de 8 segundos a Sheets, CORS existente y no-store.

Caché estática 2.3.10. /api/turnos y demás respuestas privadas no se cachean.
Sin dependencias nuevas, almacenamiento de navegador, cookies ni credenciales
nuevas. Pruebas con fixtures sintéticos y Sheets simulado; no se consultaron
datos reales ni se desplegó. Pendiente verificación visual en iPhone y lectura
autenticada de producción después de un despliegue autorizado.
