# Backend de Jarvis

Node.js 24, HTTP nativo y una dependencia directa: `google-auth-library`. La
librería oficial verifica firma, audiencia, emisor y tiempo usando claves públicas
rotatorias de Google. También exigimos `exp` futuro estricto y `sub` no vacío.
Sin Client Secret, credenciales Cloud, Service Account JSON ni conexión Sheets.

## Instalación y variables privadas

Necesitas Node.js 24 con npm (incluido en la distribución oficial de Node):

```powershell
cd C:\JarvisLifeTracker\backend
npm ci --ignore-scripts
```

El lockfile fija versiones. Para iniciar sin archivos ni valores privados en el
historial de comandos, después de obtener tu sub con el procedimiento siguiente:

```powershell
$env:NODE_ENV = 'development'
$env:PORT = '8080'
$env:HOST = '127.0.0.1'
$env:AUTHORIZED_GOOGLE_SUB = Read-Host 'Pega tu sub verificado en esta terminal privada'
npm start
```

No inventes el sub. Sin configurarlo, un token válido recibe 503 y nunca autorización;
un token ausente/inválido recibe 401. El Client ID público esperado está fijado en
`src/config.js`, nunca se obtiene de una petición.

Alternativa: copia `.env.example` a `backend/.env`, edítalo localmente y ejecuta
`npm run dev`. El archivo real está ignorado por Git y excluido del contexto Docker.
Nunca uses `git add -f`, publiques el directorio con `.env` ni copies su contenido
al frontend. El sub es un identificador personal privado, no una contraseña.

## Descubrir el sub explícitamente

No hay endpoint de bootstrap en la API. La herramienta está excluida de la imagen.
Requiere NODE_ENV=development, terminal interactiva y flag `--discover-sub`;
rechaza indicadores Cloud Run/CI. Escucha solo loopback, con ruta aleatoria, nonce,
Host y Origin comprobados. Termina al verificar una identidad o a los cinco minutos.

1. Detén el frontend en puerto 8000 (Ctrl+C) y cierra su pestaña normal.
2. En una terminal privada, sin transcripción/grabación ni redirección de salida:

   ```powershell
   cd C:\JarvisLifeTracker\backend
   $env:NODE_ENV = 'development'
   npm run bootstrap
   ```

   Equivalente: `node tools/discover-sub.js --discover-sub` con esa variable definida.
3. Abre la URL `http://localhost:8000/discover-...` que imprime e inicia sesión con
   la cuenta que deseas autorizar. No copies tokens: GIS los envía desde memoria
   a la herramienta, que usa la misma validación criptográfica que la API.
4. Solo después de verificar, el sub aparece en la terminal privada. El navegador
   recibe únicamente `{"ok":true}`. No se imprime token, correo ni otros claims,
   no se escriben archivos y no se autoriza automáticamente esa cuenta.
5. Copia el identificador a `AUTHORIZED_GOOGLE_SUB` mediante `Read-Host`, o a tu
   `.env` ignorado. No lo compartas en Git/chat. Cierra la pestaña temporal y limpia
   o cierra esa terminal cuando ya no necesites el identificador.
6. Reinicia backend con la variable y vuelve a iniciar el frontend normal.

La herramienta se cierra tras éxito; Ctrl+C la cancela. Puedes eliminar
`backend/tools/` y el script `bootstrap` de package.json después del aprovisionamiento:
la API no depende de ellos. No existe una variable que active bootstrap en la API.
El servidor estático normal solo sirve recursos públicos permitidos, nunca backend.

## Flujo completo

1. Inicia backend con el sub configurado: `npm start` o `npm run dev`.
2. [GET /health](http://127.0.0.1:8080/health) debe devolver `{"ok":true}`.
3. En otra terminal:

   ```powershell
   cd C:\JarvisLifeTracker
   $env:PORT = '8000'
   node scripts/serve.cjs
   ```

4. Abre exactamente `http://localhost:8000/`. Si hay una PWA anterior, pulsa
   «Actualizar» o cierra sus pestañas y vuelve a abrirla para activar versión 2.3.2.
5. Google Sign-In envía `POST http://127.0.0.1:8080/auth/me` con Bearer desde memoria,
   sin cookies, cuerpo ni redirects. La cuenta permitida obtiene **«Identidad validada;
   usuario autorizado por el backend. Todavía no hay datos privados conectados.»**
6. Prueba otra cuenta válida: 403. Token inválido/expirado: 401; sin cuenta configurada:
   503. Red caída o respuesta inesperada: nunca se confirma autorización.
7. Descartar o entrar a demo invalida respuestas en vuelo. No exportes solicitudes
   con Authorization ni copies comandos cURL que contengan tokens reales.

`../config.js` define la URL pública de API: `http://127.0.0.1:8080` desde
los hosts `localhost`/`127.0.0.1` y `https://jarvislifetracker-505633966366.northamerica-south1.run.app`
desde el host `luigytc.github.io`. Los demás hosts quedan sin backend configurado.
OAuth y CORS siguen requiriendo `http://localhost:8000` para el login local.
HTTP solo se permite a loopback desde el origen local. Jamás poner identificadores
personales o credenciales en esa configuración.

## Contrato y seguridad

| Petición | Resultado |
| --- | --- |
| GET /health | 200, `{"ok":true}` sin configuración |
| POST /auth/me sin Bearer o con token inválido/expirado | 401 |
| Token válido, sub no permitido | 403 |
| Token válido, sin sub configurado | 503 |
| Token válido y autorizado | 200, `{"authenticated":true,"authorized":true}` |
| Origin presente no permitido | 403 sin Allow-Origin |
| OPTIONS permitido | 204, Authorization permitido |

CORS solo permite `http://localhost:8000` y `https://luigytc.github.io`. No usa `*`
ni cookies. Los clientes sin Origin siguen sujetos a autenticación: CORS no autoriza.
No se acepta token por URL/cuerpo, ni cuerpos en /auth/me. Todas las respuestas,
incluidos errores, llevan no-store. La API solo registra mensajes mínimos de arranque,
nunca cabeceras, cuerpos, tokens o excepciones de Google. Fallos de verificación,
incluido timeout o indisponibilidad de claves, cierran el acceso con 401.

## Pruebas

```powershell
cd C:\JarvisLifeTracker
node --test backend/test/*.test.js tests/*.test.cjs
```

Las pruebas HTTP usan dobles de verificación. Las de criptografía generan claves
RSA efímeras y tokens sintéticos en memoria y usan el verificador real de Google
con certificados públicos de prueba. Comprueban firma alterada, audiencia/emisor
incorrectos y expiración. No usan tokens reales ni sustituyen el login manual.

## Contenedor y Cloud Run

El frontend apunta al servicio público
`https://jarvislifetracker-505633966366.northamerica-south1.run.app`.
Se verificaron salud (200), preflight desde GitHub Pages (204), rechazo sin
identidad (401) y rechazo de un origen no permitido (403), con `no-store`.
Esto no verifica la cuenta autorizada: el login real sigue siendo una prueba manual.

Construcción local opcional, con Docker instalado:

```powershell
docker build -t jarvis-backend ./backend
```

Node 24, dependencias de producción fijadas, `USER node`, copia explícita solo de src
y manifiestos. `.dockerignore` excluye por defecto todo: .env, herramientas, tests y
dependencias locales. En producción escucha `0.0.0.0:$PORT`; Cloud Run termina TLS.
No poner valores privados en Dockerfile, argumentos de build o repositorio.

Para reproducir el despliegue en otro entorno, elegir proyecto/región, registro de imagen, permisos de build/deploy,
configuración privada AUTHORIZED_GOOGLE_SUB (preferiblemente Secret Manager) y URL
HTTPS pública. Configurar límites de instancias/solicitudes y observabilidad sin
cabeceras Bearer/cuerpos. Se necesita salida HTTPS a las claves públicas de Google.
/health acredita vida, no autorización configurada.

El endpoint debe ser invocable por el navegador a nivel de plataforma; **el código
de la API valida y autoriza**. No confundir el ID token GIS (audiencia cliente OAuth)
con IAM de invocación Cloud Run (otra audiencia). La identidad de ejecución tendrá
permisos mínimos y ningún permiso Sheets en esta fase. No hace falta descargar claves.

Referencias: [validación Google](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token),
[contrato Cloud Run](https://docs.cloud.google.com/run/docs/container-contract).
