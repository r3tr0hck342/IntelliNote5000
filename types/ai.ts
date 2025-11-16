export type ProviderId = 'gemini' | 'openai';

export interface ApiConfig {
    provider: ProviderId;
    apiKey: string;
    baseUrl?: string;
}
