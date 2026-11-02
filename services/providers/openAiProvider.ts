import { ChatMessage } from '../../types';
import { formatContext, getPromptForMode, getFlashcardPrompt, getTagPrompt, getChatSystemPrompt, getEditPrompt } from '../aiPrompts';
import { AiProvider, ProviderMetadata, ProviderRuntimeOptions, AiChatChunk } from './types';
import { ApiConfig, ProviderId } from '../../types/ai';
import { mapProviderError } from './errors';
import { httpFetch } from '../../utils/http';
import { dryRunMessage, parseFlashcards, parseTags, resolveModel } from './shared';

// Every provider here speaks the OpenAI Chat Completions API; only the defaults differ.
export const openAiMetadata: ProviderMetadata = {
    id: 'openai',
    label: 'OpenAI',
    description: 'GPT models via the OpenAI API. Also works with any OpenAI-compatible proxy (Azure, LiteLLM…) through a custom base URL.',
    docsUrl: 'https://platform.openai.com/docs/models',
    keyLabel: 'OpenAI API Key',
    supportsLiveTranscription: false,
    allowsCustomBaseUrl: true,
    requiresApiKey: true,
    defaultBaseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    defaultAdvancedModel: 'gpt-4o',
    suggestedModels: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini', 'gpt-4.1'],
};

export const openRouterMetadata: ProviderMetadata = {
    id: 'openrouter',
    label: 'OpenRouter',
    description: 'One key for hundreds of models. Model IDs ending in ":free" cost nothing (rate-limited).',
    docsUrl: 'https://openrouter.ai/models?max_price=0',
    keyLabel: 'OpenRouter API Key',
    notes: 'The free model list changes often. Browse openrouter.ai/models (price: free) and paste any ":free" model ID.',
    supportsLiveTranscription: false,
    allowsCustomBaseUrl: true,
    isFree: true,
    requiresApiKey: true,
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'meta-llama/llama-3.3-70b-instruct:free',
    defaultAdvancedModel: 'deepseek/deepseek-chat-v3-0324:free',
    suggestedModels: [
        'meta-llama/llama-3.3-70b-instruct:free',
        'deepseek/deepseek-chat-v3-0324:free',
        'qwen/qwen-2.5-72b-instruct:free',
        'google/gemma-3-27b-it:free',
        'mistralai/mistral-small-3.1-24b-instruct:free',
    ],
};

export const ollamaMetadata: ProviderMetadata = {
    id: 'ollama',
    label: 'Ollama (local)',
    description: 'Runs open models on your own computer. Free, private, works offline.',
    docsUrl: 'https://ollama.com/library',
    keyLabel: 'API Key (not needed)',
    placeholder: 'Leave empty',
    notes: 'Install Ollama, then run e.g. `ollama pull llama3.2`. For the web version, start Ollama with OLLAMA_ORIGINS=* so the browser may call it.',
    supportsLiveTranscription: false,
    allowsCustomBaseUrl: true,
    isFree: true,
    requiresApiKey: false,
    defaultBaseUrl: 'http://localhost:11434/v1',
    defaultModel: 'llama3.2',
    defaultAdvancedModel: 'llama3.1:8b',
    suggestedModels: ['llama3.2', 'llama3.1:8b', 'qwen2.5:7b', 'gemma2:9b', 'mistral'],
};

export const mistralMetadata: ProviderMetadata = {
    id: 'mistral',
    label: 'Mistral AI',
    description: 'Mistral models via La Plateforme.',
    docsUrl: 'https://docs.mistral.ai/getting-started/models/',
    keyLabel: 'Mistral API Key',
    supportsLiveTranscription: false,
    requiresApiKey: true,
    defaultBaseUrl: 'https://api.mistral.ai/v1',
    defaultModel: 'mistral-small-latest',
    defaultAdvancedModel: 'mistral-large-latest',
    suggestedModels: ['mistral-small-latest', 'mistral-medium-latest', 'mistral-large-latest'],
};

export const deepSeekMetadata: ProviderMetadata = {
    id: 'deepseek',
    label: 'DeepSeek',
    description: 'DeepSeek chat and reasoning models. Low cost.',
    docsUrl: 'https://api-docs.deepseek.com/quick_start/pricing',
    keyLabel: 'DeepSeek API Key',
    supportsLiveTranscription: false,
    requiresApiKey: true,
    defaultBaseUrl: 'https://api.deepseek.com',
    defaultModel: 'deepseek-chat',
    defaultAdvancedModel: 'deepseek-reasoner',
    suggestedModels: ['deepseek-chat', 'deepseek-reasoner'],
};

export const xAiMetadata: ProviderMetadata = {
    id: 'xai',
    label: 'xAI Grok',
    description: 'Grok models via the xAI API.',
    docsUrl: 'https://docs.x.ai/docs/models',
    keyLabel: 'xAI API Key',
    supportsLiveTranscription: false,
    requiresApiKey: true,
    defaultBaseUrl: 'https://api.x.ai/v1',
    defaultModel: 'grok-3-mini',
    defaultAdvancedModel: 'grok-3',
    suggestedModels: ['grok-3-mini', 'grok-3'],
};

interface OpenAiMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

interface ChatCompletionResponse {
    choices?: { message?: { content?: string | null } }[];
}

const buildHistory = (history: ChatMessage[]): OpenAiMessage[] => history.map(msg => ({
    role: msg.role === 'model' ? 'assistant' : 'user',
    content: msg.content,
}));

export const createOpenAiCompatibleProvider = (config: ApiConfig, metadata: ProviderMetadata): AiProvider => {
    const providerId: ProviderId = metadata.id;
    const endpoint = `${(config.baseUrl?.trim() || metadata.defaultBaseUrl || '').replace(/\/$/, '')}/chat/completions`;

    // No temperature: newer OpenAI models reject non-default values, and defaults are fine here.
    const complete = async (messages: OpenAiMessage[], options?: ProviderRuntimeOptions): Promise<string> => {
        try {
            const response = await httpFetch(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
                },
                body: JSON.stringify({ model: resolveModel(config, metadata, options), messages }),
            });
            if (!response.ok) {
                throw mapProviderError({ status: response.status, message: await response.text() }, providerId);
            }
            const result = (await response.json()) as ChatCompletionResponse;
            return result.choices?.[0]?.message?.content?.trim() ?? '';
        } catch (error) {
            throw mapProviderError(error, providerId);
        }
    };

    return {
        id: providerId,
        metadata,
        rawConfig: config,
        processTranscript: async (transcript, mode, handouts, options) => {
            const prompt = getPromptForMode(mode, formatContext(transcript, handouts));
            if (options?.dryRun) return dryRunMessage(metadata.label, `process ${mode}`, prompt.length);
            return complete([
                { role: 'system', content: 'You are an expert academic assistant.' },
                { role: 'user', content: prompt },
            ], options);
        },
        generateFlashcards: async (transcript, handouts, options) => {
            const count = options?.count ?? 10;
            const prompt = `${getFlashcardPrompt(formatContext(transcript, handouts), count)}

Return only a JSON array of objects with keys "front" and "back".`;
            if (options?.dryRun) {
                return Array.from({ length: count }, (_, index) => ({
                    front: `Dry run card ${index + 1}`,
                    back: dryRunMessage(metadata.label, 'flashcards', prompt.length),
                }));
            }
            const text = await complete([
                { role: 'system', content: 'You create excellent study flashcards.' },
                { role: 'user', content: prompt },
            ], options);
            return parseFlashcards(text);
        },
        generateTags: async (transcript, handouts, options) => {
            const prompt = `${getTagPrompt(formatContext(transcript, handouts))}

Return only a valid JSON array.`;
            if (options?.dryRun) return ['dry-run', `${providerId}:${prompt.length}`];
            // Tags always use the normal (fast) model.
            const text = await complete([
                { role: 'system', content: 'You extract concise topical tags.' },
                { role: 'user', content: prompt },
            ]);
            return parseTags(text);
        },
        generateChatStream: async function* (history, message, transcript, handouts, options): AsyncGenerator<AiChatChunk> {
            const messages: OpenAiMessage[] = [
                { role: 'system', content: getChatSystemPrompt(formatContext(transcript, handouts)) },
                ...buildHistory(history),
                { role: 'user', content: message },
            ];
            if (options?.dryRun) {
                yield { textDelta: dryRunMessage(metadata.label, 'chat', messages.map(item => item.content).join('\n').length) };
                return;
            }
            const text = await complete(messages, options);
            if (text) yield { textDelta: text };
        },
        editTranscript: async (text, mode, options) => {
            const prompt = getEditPrompt(mode, text, options?.customPrompt);
            if (options?.dryRun) return dryRunMessage(metadata.label, `edit ${mode}`, prompt.length);
            return complete([
                { role: 'system', content: 'You faithfully transform text according to instructions.' },
                { role: 'user', content: prompt },
            ], options);
        },
    };
};
