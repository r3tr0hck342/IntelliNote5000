import { isTauri } from './native';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

// Requests carry API keys, so plain HTTP is only allowed to this machine (e.g. Ollama, a local Whisper server).
export const assertSecureEndpoint = (url: string) => {
  const { protocol, hostname } = new URL(url);
  if (protocol === 'http:' && !LOCAL_HOSTS.has(hostname)) {
    throw new Error(`Refusing to send credentials over plain HTTP to ${hostname}. Use an https:// URL.`);
  }
};

// On desktop, provider requests go through Tauri's Rust HTTP client: it is not subject to the
// webview's CORS rules or CSP, so any provider or self-hosted endpoint works. Elsewhere, plain fetch.
export const httpFetch: typeof fetch = async (input, init) => {
  assertSecureEndpoint(input instanceof Request ? input.url : String(input));
  if (isTauri()) {
    const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http');
    return tauriFetch(input, init);
  }
  return fetch(input, init);
};
