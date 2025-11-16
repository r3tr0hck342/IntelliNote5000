import { ApiConfig, getCachedApiConfig } from './apiConfig';
import { ProviderId } from '../types/ai';
import { DEFAULT_PROVIDER_ID } from '../services/providers';

const getRuntimeInjectedConfig = (): ApiConfig | null => {
    if (typeof window === 'undefined') return null;
    const injected = (window as any).__INTELLINOTE_API_CONFIG;
    if (injected && typeof injected.apiKey === 'string' && injected.apiKey.length > 0) {
        return injected;
    }
    return getCachedApiConfig();
};

const getViteEnv = (): Record<string, any> | undefined => {
    try {
        return typeof import.meta !== 'undefined' ? (import.meta as any).env : undefined;
    } catch {
        return undefined;
    }
};

const getEnvFallbackConfig = (): ApiConfig | null => {
    const viteEnv = getViteEnv();
    const viteKey = viteEnv?.VITE_API_KEY;
    const processKey = typeof process !== 'undefined' ? process.env?.API_KEY : undefined;
    const apiKey = viteKey || processKey;
    if (!apiKey) return null;
    const provider = ((viteEnv?.VITE_AI_PROVIDER) ||
        (typeof process !== 'undefined' ? process.env?.AI_PROVIDER : undefined) ||
        DEFAULT_PROVIDER_ID) as ProviderId;
    const baseUrl = (viteEnv?.VITE_AI_BASE_URL) ||
        (typeof process !== 'undefined' ? process.env?.AI_BASE_URL : undefined);
    return {
        provider,
        apiKey,
        baseUrl: baseUrl || undefined,
    };
};

export const getActiveApiConfig = (): ApiConfig | null => {
    return getRuntimeInjectedConfig() ?? getEnvFallbackConfig();
};

export const getRequiredApiConfig = (): ApiConfig => {
    const config = getActiveApiConfig();
    if (!config || !config.apiKey) {
        throw new Error("AI provider not configured. Open Settings to add an API key.");
    }
    return config;
};

export const getActiveProviderId = (): ProviderId | null => {
    return getActiveApiConfig()?.provider ?? null;
};
