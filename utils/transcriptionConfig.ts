import { SttConfig, SttProviderId } from '../types/stt';
import { transcriptionStorage } from './transcriptionStorage';

let inMemoryConfig: SttConfig | null = null;

const setRuntimeCache = (config: SttConfig | null) => {
  if (typeof window === 'undefined') return;
  if (config) {
    (window as any).__INTELLINOTE_STT_CONFIG = config;
  } else {
    delete (window as any).__INTELLINOTE_STT_CONFIG;
  }
};

export const getCachedSttConfig = (): SttConfig | null => {
  if (typeof window !== 'undefined') {
    const runtime = (window as any).__INTELLINOTE_STT_CONFIG;
    if (runtime && typeof runtime.apiKey === 'string') {
      return runtime;
    }
  }
  return inMemoryConfig;
};

export const loadSttConfig = async (): Promise<SttConfig | null> => {
  const cached = getCachedSttConfig();
  if (cached) return cached;
  const stored = await transcriptionStorage.get();
  if (stored) {
    inMemoryConfig = stored;
    setRuntimeCache(stored);
    return stored;
  }
  return null;
};

export const persistSttConfig = async (config: SttConfig) => {
  inMemoryConfig = config;
  setRuntimeCache(config);
  await transcriptionStorage.set(config);
};

export const clearStoredSttConfig = async () => {
  inMemoryConfig = null;
  setRuntimeCache(null);
  await transcriptionStorage.clear();
};

const getViteEnv = (): Record<string, any> | undefined => {
  try {
    return typeof import.meta !== 'undefined' ? (import.meta as any).env : undefined;
  } catch {
    return undefined;
  }
};

const getEnvFallbackConfig = (): SttConfig | null => {
  const viteEnv = getViteEnv();
  const viteKey = viteEnv?.VITE_STT_API_KEY;
  const processKey = typeof process !== 'undefined' ? process.env?.STT_API_KEY : undefined;
  const apiKey = viteKey || processKey;
  if (!apiKey) return null;
  const provider = ((viteEnv?.VITE_STT_PROVIDER) ||
    (typeof process !== 'undefined' ? process.env?.STT_PROVIDER : undefined) ||
    'deepgram') as SttProviderId;
  const language = viteEnv?.VITE_STT_LANGUAGE || (typeof process !== 'undefined' ? process.env?.STT_LANGUAGE : undefined);
  const model = viteEnv?.VITE_STT_MODEL || (typeof process !== 'undefined' ? process.env?.STT_MODEL : undefined);
  return {
    provider,
    apiKey,
    language: language || undefined,
    model: model || undefined,
  };
};

export const getActiveSttConfig = (): SttConfig | null => {
  if (typeof window !== 'undefined') {
    const runtime = (window as any).__INTELLINOTE_STT_CONFIG;
    if (runtime && typeof runtime.apiKey === 'string') {
      return runtime;
    }
  }
  return getCachedSttConfig() ?? getEnvFallbackConfig();
};

export const getRequiredSttConfig = (): SttConfig => {
  const config = getActiveSttConfig();
  if (!config || !config.apiKey) {
    throw new Error('Transcription provider not configured. Open Settings to add a transcription API key.');
  }
  return config;
};
