// Public endpoints only. Never place identities or secrets in this file.
(() => {
  const { hostname, protocol } = window.location;
  let apiBaseUrl = '';
  if (hostname === 'luigytc.github.io') {
    apiBaseUrl = 'https://jarvislifetracker-505633966366.northamerica-south1.run.app';
  } else if ((hostname === 'localhost' || hostname === '127.0.0.1') &&
      (protocol === 'http:' || protocol === 'https:')) {
    apiBaseUrl = 'http://127.0.0.1:8080';
  }
  window.JarvisConfig = Object.freeze({ apiBaseUrl });
})();
