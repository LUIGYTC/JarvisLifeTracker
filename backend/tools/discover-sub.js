import { assertBootstrapAllowed, createBootstrapServer } from './bootstrap.js';

try {
  assertBootstrapAllowed(process.env, process.argv.slice(2), process.stdin.isTTY && process.stdout.isTTY);
  const { server, route } = createBootstrapServer({ onVerified: sub => {
    // Deliberate private output requested by the operator, never the token/claims.
    console.log('\nIdentificador verificado (privado; no copiar a Git ni al chat):');
    console.log(sub);
    console.log('Configúralo como AUTHORIZED_GOOGLE_SUB en tu entorno privado. No se ha autorizado automáticamente.');
  } });
  server.on('error', () => { console.error('No se pudo abrir localhost:8000. Detén primero el servidor frontend.'); process.exitCode = 1; });
  server.listen(8000, 'localhost', () => {
    console.log('Herramienta local temporal. No uses transcripciones ni redirección de salida.');
    console.log(`Abre http://localhost:8000${route}`);
  });
  const timer = setTimeout(() => { server.closeAllConnections(); server.close(); }, 5 * 60 * 1000);
  timer.unref();
  server.on('close', () => clearTimeout(timer));
} catch {
  console.error('Bootstrap deshabilitado: requiere NODE_ENV=development, --discover-sub y terminal interactiva; no se admite Cloud Run/CI.');
  process.exitCode = 1;
}
