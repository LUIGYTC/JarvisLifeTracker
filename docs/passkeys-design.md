# Passkeys: propuesta pendiente de decisiones de infraestructura

Estado: evaluación, no implementación. Se conserva Google Sign-In y la
navegación Home/Finanzas actual. No se han creado endpoints, dependencias,
cookies, credenciales WebAuthn ni recursos externos.

## Motivos para detener la implementación

La solicitud exige detener la persistencia si Sheets no resulta adecuado y
proponer una arquitectura segura si las cookies entre Pages y Cloud Run fallan
en Safari. Ambos problemas afectan al diseño completo de autenticación.

El adapter actual de Sheets usa lecturas y escrituras separadas. Su ledger de
movimientos documenta expresamente que no ofrece compare-and-set ni una
transacción para decidir y escribir. Reutilizarlo para consumir challenges o
actualizar contadores permitiría carreras entre instancias. Las credenciales
públicas pueden almacenarse en Sheets, pero eso no resuelve la coordinación
atómica del resto del flujo. No se propone modificar ninguna hoja.

Pages y Cloud Run son sitios distintos. Una cookie Secure, HttpOnly y
SameSite=None, incluso con CORS y credentials correctamente configurados, no
evita el bloqueo de cookies de terceros de Safari. No se propone resolverlo
persistiendo tokens en JavaScript ni debilitando la privacidad del navegador.

## Arquitectura recomendada (requiere decisión previa)

1. Firestore, accesible exclusivamente desde el backend mediante ADC e IAM,
   para credenciales públicas, challenges y sesiones. No incluir archivos de
   service account. Denegar acceso directo desde clientes web.
2. Servir la PWA y las rutas /auth y /api bajo el mismo origen HTTPS mediante
   hosting/proxy hacia Cloud Run. Elegir el dominio y el RP ID definitivo antes
   de registrar passkeys. No se ha provisionado ni cambiado el hosting actual.
3. Usar @simplewebauthn/server para generar opciones y verificar respuestas.
   No se instaló ninguna versión: seleccionar y fijar una versión mantenida,
   compatible con Node 24, en el lockfile durante la implementación y auditarla.

## Contrato previsto

Todos los endpoints de autenticación y respuestas privadas llevan no-store.
Los errores son genéricos; no registrar tokens, cookies, respuestas de
autenticadores completas ni datos privados.

| Endpoint propuesto | Responsabilidad |
| --- | --- |
| POST /auth/passkey/register/options | Exigir autorización Google reciente; emitir challenge de registro |
| POST /auth/passkey/register/verify | Verificar registro y guardar credencial pública vinculada al usuario autorizado |
| POST /auth/passkey/login/options | Emitir challenge de autenticación sin revelar identidad ni listar credenciales |
| POST /auth/passkey/login/verify | Verificar firma, consumir challenge y crear sesión Jarvis |
| POST /auth/logout | Revocar sesión servidor y expirar cookie; conservar passkey |

La autorización existente por Google sigue siendo obligatoria para dar de alta
una passkey. El servidor vincula un identificador interno opaco al usuario
autorizado por su configuración; nunca acepta esa vinculación desde el cliente.
Una sesión por passkey debe comprobar también que esa vinculación sigue
autorizada, para que cambiar la autorización revoque accesos anteriores.

Actualmente el frontend descarta el Google ID token tras cargar el dashboard.
La implementación deberá establecer una sesión propia después de verificar
Google o solicitar autorización Google reciente para el registro. No retener
ni persistir el Google token para simular una sesión duradera.

## Persistencia mínima propuesta

- Credenciales: ID de credencial, ID interno opaco de usuario, clave pública
  COSE, contador, transports, tipo de dispositivo, estado de backup y revocación.
  Nunca clave privada, correo, token Google ni información financiera.
- Ceremonias: identificador aleatorio, challenge criptográfico de 32 bytes,
  propósito, vínculo de usuario cuando corresponda, entorno/origin/RP ID
  esperados, expiración corta (por ejemplo cinco minutos) y estado de consumo.
- Sesiones: hash del identificador aleatorio de sesión, usuario interno,
  expiración y revocación. No guardar el bearer de sesión en claro.

Consumir cada ceremonia mediante una transacción antes de aceptar la
verificación; un intento fallido requiere una ceremonia nueva. Verificar con
la biblioteca challenge, origin, RP ID, tipo de ceremonia, presencia y
verificación de usuario, credencial y firma. Requerir user verification.
Actualizar contador y crear sesión en otra transacción que relea el estado
actual de la credencial, rechace revocación y aplique la política de contador
de la biblioteca, incluidos autenticadores con contador cero. Evitar efectos
externos en callbacks de transacciones que Firestore pueda repetir.

Si el proceso muere tras consumir el challenge, se inicia otra ceremonia: no
se vuelve a aceptar el anterior. Los TTL sirven para limpieza; cada request
debe comprobar expiración explícitamente. Aplicar límites de solicitudes,
tamaño y número de ceremonias para evitar abuso de endpoints públicos.

## Sesión, orígenes y dispositivos

Con origen común: cookie __Host-jarvis, Secure, HttpOnly, SameSite=Lax,
Path=/ y sin Domain; duración limitada y revocable. Proteger mutaciones con
verificación estricta de Origin y un token CSRF ligado a la sesión, mantenido
solo en memoria del cliente. No ampliar CORS indiscriminadamente.

La configuración actual solicitada sería RP ID luigytc.github.io y origin
https://luigytc.github.io. En desarrollo: RP ID localhost y origin
http://localhost:8000 (el puerto pertenece al origin, no al RP ID). Configurar
entornos por separado desde el servidor, sin aceptar RP ID del cliente. Para
probar cookies Secure de forma fiel, usar HTTPS local y un proxy del mismo
origen. No asumir que localhost y 127.0.0.1 comparten credenciales.

Cambiar de dominio no migra automáticamente las passkeys del RP anterior.
Confirmar dominio final antes del enrolamiento; otros proyectos bajo el mismo
origin de GitHub Pages tampoco quedan aislados por el path de esta PWA.

En iPhone, el sistema elige Face ID, Touch ID, PIN u otro método disponible.
La UI dirá «Entrar con passkey» y «Activar acceso rápido». Sin soporte, Google
seguirá disponible. Deben probarse Safari y la PWA instalada por separado,
incluidos cancelación, recuperación y cierre de sesión. No se promete que
instalar la PWA resuelva las cookies cross-site.

## Verificación requerida al implementar

Pruebas con firmas WebAuthn reales de fixtures y biblioteca real: registro y
login correctos, firma inválida, credencial desconocida, challenge incorrecto,
expirado y reutilizado, origin/RP incorrectos y user verification ausente.
Probar usuario no autorizado, contador, revocación, CSRF, logout, fallback y
exclusión del service worker. Con emulador de Firestore, probar consumo
concurrente desde dos clientes y reinicio del servicio. Los mocks de transporte
no deben sustituir la verificación criptográfica. Mantener toda la suite actual.

## Configuración manual pendiente

Antes de implementar: acordar Firestore y dominio/hosting de origen común.
Después: crear base/región, IAM mínimo para la service account, reglas que
denieguen acceso web directo y política TTL; configurar proxy, TLS, RP ID y
orígenes explícitos. Actualizar orígenes de Google autorizados si cambia el
dominio. Revisar costes, revocación y recuperación. Nada de esto se ejecutó.

## Referencias oficiales

- https://webkit.org/tracking-prevention/
- https://firebase.google.com/docs/firestore/manage-data/transactions
- https://simplewebauthn.dev/docs/packages/server
- Limitaciones del adapter actual: movimientos-idempotency.md en este directorio.
