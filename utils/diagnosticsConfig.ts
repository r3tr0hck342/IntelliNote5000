const STORAGE_KEY = 'intellinote-diagnostics-enabled';

export const loadDiagnosticsPreference = (): boolean => {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return false;
  return localStorage.getItem(STORAGE_KEY) === 'true';
};

export const persistDiagnosticsPreference = (enabled: boolean) => {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, enabled ? 'true' : 'false');
};
