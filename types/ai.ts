export type ProviderId =
    | 'gemini'
    | 'anthropic'
    | 'openai'
    | 'openrouter'
    | 'ollama'
    | 'mistral'
    | 'deepseek'
    | 'xai';

export interface ApiConfig {
    provider: ProviderId;
    /** Empty for providers that need no key (e.g. local Ollama). */
    apiKey: string;
    baseUrl?: string;
    /** Model for normal requests; falls back to the provider's default. */
    model?: string;
    /** Model used when Intelligence Mode is on; falls back to the provider's default. */
    advancedModel?: string;
}
