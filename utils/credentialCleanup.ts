import { clearStoredApiConfig } from './apiConfig';
import { clearStoredSttConfig } from './transcriptionConfig';
import { clearCredentialFallbackPreference } from './credentialPolicy';

const LOCAL_API_KEY = 'intellinote-api-config';
const LOCAL_STT_KEY = 'intellinote-stt-config';

export const clearAllCredentials = async () => {
  await Promise.all([clearStoredApiConfig(), clearStoredSttConfig()]);
  if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
    localStorage.removeItem(LOCAL_API_KEY);
    localStorage.removeItem(LOCAL_STT_KEY);
  }
  clearCredentialFallbackPreference();
};
