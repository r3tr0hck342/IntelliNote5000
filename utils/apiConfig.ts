import { ApiConfig, ProviderId } from '../types/ai';

export type { ApiConfig };
import { secureStorage } from './secureStorage';

let inMemoryConfig: ApiConfig | null = null;

const setRuntimeCache = (config: ApiConfig | null) => {
    if (typeof window === 'undefined') return;
    if (config) {
        window.__INTELLINOTE_API_CONFIG = config;
    } else {
        delete window.__INTELLINOTE_API_CONFIG;
    }
};

export const getCachedApiConfig = (): ApiConfig | null => {
    if (typeof window !== 'undefined') {
        const runtime = window.__INTELLINOTE_API_CONFIG;
        if (runtime && typeof runtime.apiKey === 'string') {
            return runtime;
        }
    }
    return inMemoryConfig;
};

export const loadApiConfig = async (): Promise<ApiConfig | null> => {
    const cached = getCachedApiConfig();
    if (cached) return cached;
    const stored = await secureStorage.get();
    if (stored) {
        inMemoryConfig = stored;
        setRuntimeCache(stored);
        return stored;
    }
    return null;
};

export const persistApiConfig = async (config: ApiConfig) => {
    inMemoryConfig = config;
    setRuntimeCache(config);
    await secureStorage.set(config);
};

export const clearStoredApiConfig = async () => {
    inMemoryConfig = null;
    setRuntimeCache(null);
    await secureStorage.clear();
};

export const clearCachedApiConfig = () => {
    inMemoryConfig = null;
    setRuntimeCache(null);
};
