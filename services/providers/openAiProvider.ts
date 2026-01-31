import { GenerationMode, Flashcard, Handout, TranscriptSegment, ChatMessage, AiEditMode } from '../../types';
import { formatContext, getPromptForMode, getFlashcardPrompt, getTagPrompt, getChatSystemPrompt, getEditPrompt } from '../aiPrompts';
import { AiProvider, ProviderMetadata, ProviderRuntimeOptions, AiChatChunk } from './types';
import { ApiConfig } from '../../utils/apiConfig';
import { mapProviderError } from './errors';

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const FAST_MODEL = 'gpt-4o-mini';
const PRO_MODEL = 'gpt-4o';

export const openAiMetadata: ProviderMetadata = {
    id: 'openai',
    label: 'OpenAI (Chat Completions)',
    description: 'Use OpenAI API keys for GPT-4o family models. Streaming transcription is configured separately.',
    docsUrl: 'https://platform.openai.com/docs',
    keyLabel: 'OpenAI API Key',
    notes: 'Requires Chat Completions access.',
    supportsLiveTranscription: false,
    allowsCustomBaseUrl: true,
};

interface OpenAiMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

const buildEndpoint = (config: ApiConfig) => {
    const base = config.baseUrl?.trim() || DEFAULT_BASE_URL;
    return `${base.replace(/\/$/, '')}/chat/completions`;
};

const callOpenAi = async (config: ApiConfig, body: Record<string, any>) => {
    try {
        const response = await fetch(buildEndpoint(config), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.apiKey}`,
            },
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw mapProviderError({ status: response.status, message: errorText }, 'openai');
        }

        return response.json();
    } catch (error) {
        throw mapProviderError(error, 'openai');
    }
};

const buildHistory = (history: ChatMessage[]): OpenAiMessage[] => history.map(msg => ({
    role: msg.role === 'model' ? 'assistant' : 'user',
    content: msg.content,
}));

const selectModel = (options?: ProviderRuntimeOptions) => (options?.useIntelligenceMode ? PRO_MODEL : FAST_MODEL);
const buildDryRunMessage = (provider: string, action: string, payloadLength: number) =>
    `[Dry Run] ${provider} ${action} would send ${payloadLength} characters.`;

export const createOpenAiProvider = (config: ApiConfig): AiProvider => {
    return {
        id: 'openai',
        metadata: openAiMetadata,
        rawConfig: config,
        processTranscript: async (transcript, mode, handouts, options) => {
            try {
                const context = formatContext(transcript, handouts);
                const prompt = getPromptForMode(mode, context);
                if (options?.dryRun) {
                    return buildDryRunMessage('OpenAI', `process ${mode}`, prompt.length);
                }
                const result = await callOpenAi(config, {
                    model: selectModel(options),
                    messages: [
                        { role: 'system', content: 'You are an expert academic assistant.' },
                        { role: 'user', content: prompt },
                    ],
                    temperature: 0.3,
                });
                return result.choices?.[0]?.message?.content?.trim() ?? '';
            } catch (error) {
                throw mapProviderError(error, 'openai');
            }
        },
        generateFlashcards: async (transcript, handouts, options) => {
            try {
                const context = formatContext(transcript, handouts);
                const prompt = `${getFlashcardPrompt(context, options?.count ?? 10)}

Return the flashcards as a JSON array with objects using keys "front" and "back".`;
                if (options?.dryRun) {
                    const count = options?.count ?? 10;
                    return Array.from({ length: count }, (_, index) => ({
                        front: `Dry run card ${index + 1}`,
                        back: buildDryRunMessage('OpenAI', 'flashcards', prompt.length),
                    }));
                }
                const result = await callOpenAi(config, {
                    model: selectModel(options),
                    messages: [
                        { role: 'system', content: 'You create excellent study flashcards.' },
                        { role: 'user', content: prompt },
                    ],
                    temperature: 0.4,
                });
                const text = result.choices?.[0]?.message?.content ?? '[]';
                return JSON.parse(text);
            } catch (error) {
                throw mapProviderError(error, 'openai');
            }
        },
        generateTags: async (transcript, handouts, options) => {
            try {
                const context = formatContext(transcript, handouts);
                const prompt = `${getTagPrompt(context)}

Return only a valid JSON array.`;
                if (options?.dryRun) {
                    return ['dry-run', `openai:${prompt.length}`];
                }
                const result = await callOpenAi(config, {
                    model: FAST_MODEL,
                    messages: [
                        { role: 'system', content: 'You extract concise topical tags.' },
                        { role: 'user', content: prompt },
                    ],
                    temperature: 0.2,
                });
                const text = result.choices?.[0]?.message?.content ?? '[]';
                return JSON.parse(text);
            } catch (error) {
                throw mapProviderError(error, 'openai');
            }
        },
        generateChatStream: async function* (history, message, transcript, handouts, options): AsyncGenerator<AiChatChunk> {
            try {
                const context = formatContext(transcript, handouts);
                const messages: OpenAiMessage[] = [
                    { role: 'system', content: getChatSystemPrompt(context) },
                    ...buildHistory(history),
                    { role: 'user', content: message },
                ];
                if (options?.dryRun) {
                    yield { textDelta: buildDryRunMessage('OpenAI', 'chat', messages.map(item => item.content).join('\n').length) };
                    return;
                }
                const result = await callOpenAi(config, {
                    model: selectModel(options),
                    messages,
                    temperature: 0.3,
                });
                const text = result.choices?.[0]?.message?.content ?? '';
                if (text) {
                    yield { textDelta: text };
                }
            } catch (error) {
                throw mapProviderError(error, 'openai');
            }
        },
        editTranscript: async (text, mode, options) => {
            try {
                const prompt = getEditPrompt(mode, text, options?.customPrompt);
                if (options?.dryRun) {
                    return buildDryRunMessage('OpenAI', `edit ${mode}`, prompt.length);
                }
                const result = await callOpenAi(config, {
                    model: selectModel(options),
                    messages: [
                        { role: 'system', content: 'You faithfully transform text according to instructions.' },
                        { role: 'user', content: prompt },
                    ],
                    temperature: 0.2,
                });
                return result.choices?.[0]?.message?.content?.trim() ?? '';
            } catch (error) {
                throw mapProviderError(error, 'openai');
            }
        },
    };
};
