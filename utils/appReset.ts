import { clearPersistedSessions } from './sessionStorage';
import { clearAutoGenerationConfig } from './autoGenerationConfig';
import { clearDiagnosticsPreference } from './diagnosticsConfig';
import { clearCredentialFallbackPreference } from './credentialPolicy';
import { clearLocalApiConfig } from './secureStorage';
import { clearLocalSttConfig } from './transcriptionStorage';
import { clearCachedApiConfig } from './apiConfig';
import { clearCachedSttConfig } from './transcriptionConfig';
import { clearStoredApiConfig } from './apiConfig';
import { clearStoredSttConfig } from './transcriptionConfig';

interface ResetOptions {
  includeSecureStorage?: boolean;
}

export const resetAppState = async ({ includeSecureStorage = false }: ResetOptions = {}) => {
  clearPersistedSessions();
  clearAutoGenerationConfig();
  clearDiagnosticsPreference();
  clearCredentialFallbackPreference();
  clearLocalApiConfig();
  clearLocalSttConfig();
  clearCachedApiConfig();
  clearCachedSttConfig();

  if (includeSecureStorage) {
    await Promise.all([clearStoredApiConfig(), clearStoredSttConfig()]);
  }
};
