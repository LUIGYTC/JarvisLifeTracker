// Public audience; never take the expected audience from a request.
export const GOOGLE_CLIENT_ID = '505633966366-vfpj4puk76rksfoankm4bljdq4m5gpb4.apps.googleusercontent.com';
export const ALLOWED_ORIGINS = new Set([
  'http://localhost:8000',
  'https://luigytc.github.io'
]);

export function readConfig(env = process.env) {
  const port = Number(env.PORT || 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
  return {
    port,
    host: env.NODE_ENV === 'production' || env.K_SERVICE ? '0.0.0.0' : (env.HOST || '127.0.0.1'),
    authorizedSub: env.AUTHORIZED_GOOGLE_SUB?.trim() || ''
  };
}
