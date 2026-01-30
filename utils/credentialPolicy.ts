const PREFERENCE_KEY = 'intellinote-allow-localstorage-credentials';

export const getCredentialFallbackPreference = (): boolean => {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return false;
  return localStorage.getItem(PREFERENCE_KEY) === 'true';
};

export const setCredentialFallbackPreference = (enabled: boolean) => {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return;
  localStorage.setItem(PREFERENCE_KEY, enabled ? 'true' : 'false');
};

export const clearCredentialFallbackPreference = () => {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return;
  localStorage.removeItem(PREFERENCE_KEY);
};
