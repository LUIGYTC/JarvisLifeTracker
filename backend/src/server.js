import { createApp } from './app.js';
import { readConfig } from './config.js';

try {
  const config = readConfig();
  const server = createApp(config);
  server.on('error', () => { console.error('No se pudo iniciar el backend. Revisa host y puerto.'); process.exitCode = 1; });
  server.listen(config.port, config.host, () => console.log('Backend Jarvis listo.'));
  process.on('SIGTERM', () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 9000).unref();
  });
} catch {
  console.error('Configuración del backend inválida.');
  process.exitCode = 1;
}
