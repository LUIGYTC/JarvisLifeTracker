// Public endpoints only. Never place identities or secrets in this file.
window.JarvisConfig = Object.freeze({
  // Only the explicitly supported frontend origins receive an API endpoint.
  apiBaseUrl: window.location.origin === 'http://localhost:8000'
    ? 'http://127.0.0.1:8080'
    : window.location.origin === 'https://luigytc.github.io'
      ? 'https://jarvislifetracker-505633966366.northamerica-south1.run.app'
      : ''
});
