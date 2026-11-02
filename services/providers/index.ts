import { ApiConfig } from '../../utils/apiConfig';
import { AiProvider, ProviderMetadata } from './types';
import type { ProviderId } from '../../types/ai';
import { createGeminiProvider, geminiMetadata } from './geminiProvider';
import { createAnthropicProvider, anthropicMetadata } from './anthropicProvider';
import {
    createOpenAiCompatibleProvider,
    deepSeekMetadata,
    mistralMetadata,
    ollamaMetadata,
    openAiMetadata,
    openRouterMetadata,
    xAiMetadata,
} from './openAiProvider';

// Order is the order shown in Settings: free options first.
export const PROVIDER_METADATA: Record<ProviderId, ProviderMetadata> = {
    gemini: geminiMetadata,
    openrouter: openRouterMetadata,
    ollama: ollamaMetadata,
    anthropic: anthropicMetadata,
    openai: openAiMetadata,
    mistral: mistralMetadata,
    deepseek: deepSeekMetadata,
    xai: xAiMetadata,
};

export const DEFAULT_PROVIDER_ID: ProviderId = 'gemini';

export const isApiConfigReady = (config: ApiConfig | null | undefined): config is ApiConfig => {
    if (!config) return false;
    const metadata = PROVIDER_METADATA[config.provider];
    if (!metadata) return false;
    return metadata.requiresApiKey ? config.apiKey.trim().length > 0 : true;
};

export const createProvider = (config: ApiConfig): AiProvider => {
    switch (config.provider) {
        case 'gemini':
            return createGeminiProvider(config);
        case 'anthropic':
            return createAnthropicProvider(config);
        default: {
            const metadata = PROVIDER_METADATA[config.provider];
            return metadata ? createOpenAiCompatibleProvider(config, metadata) : createGeminiProvider(config);
        }
    }
};
