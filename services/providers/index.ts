import { ApiConfig } from '../../utils/apiConfig';
import { AiProvider, ProviderId, ProviderMetadata } from './types';
import { createGeminiProvider, geminiMetadata } from './geminiProvider';
import { createOpenAiProvider, openAiMetadata } from './openAiProvider';

export const PROVIDER_METADATA: Record<ProviderId, ProviderMetadata> = {
    gemini: geminiMetadata,
    openai: openAiMetadata,
};

export const DEFAULT_PROVIDER_ID: ProviderId = 'gemini';

export const createProvider = (config: ApiConfig): AiProvider => {
    switch (config.provider) {
        case 'openai':
            return createOpenAiProvider(config);
        case 'gemini':
        default:
            return createGeminiProvider(config);
    }
};
