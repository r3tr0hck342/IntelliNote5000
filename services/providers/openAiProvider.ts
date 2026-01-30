import { GenerationMode, Flashcard, Handout, TranscriptSegment, ChatMessage, AiEditMode } from '../../types';
import { formatContext, getPromptForMode, getFlashcardPrompt, getTagPrompt, getChatSystemPrompt, getEditPrompt } from '../aiPrompts';
import { AiProvider, ProviderMetadata, ProviderRuntimeOptions, AiChatChunk } from './types';
import { ApiConfig } from '../../utils/apiConfig';

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
        throw new Error(`OpenAI request failed: ${errorText}`);
    }

    return response.json();
};

const buildHistory = (history: ChatMessage[]): OpenAiMessage[] => history.map(msg => ({
    role: msg.role === 'model' ? 'assistant' : 'user',
    content: msg.content,
}));

const selectModel = (options?: ProviderRuntimeOptions) => (options?.useIntelligenceMode ? PRO_MODEL : FAST_MODEL);

export const createOpenAiProvider = (config: ApiConfig): AiProvider => {
    return {
        id: 'openai',
        metadata: openAiMetadata,
        rawConfig: config,
        processTranscript: async (transcript, mode, handouts, options) => {
            const context = formatContext(transcript, handouts);
            const prompt = getPromptForMode(mode, context);
            const result = await callOpenAi(config, {
                model: selectModel(options),
                messages: [
                    { role: 'system', content: 'You are an expert academic assistant.' },
                    { role: 'user', content: prompt },
                ],
                temperature: 0.3,
            });
            return result.choices?.[0]?.message?.content?.trim() ?? '';
        },
        generateFlashcards: async (transcript, handouts, options) => {
            const context = formatContext(transcript, handouts);
            const prompt = `${getFlashcardPrompt(context, options?.count ?? 10)}

Return the flashcards as a JSON array with objects using keys "front" and "back".`;
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
        },
        generateTags: async (transcript, handouts) => {
            const context = formatContext(transcript, handouts);
            const prompt = `${getTagPrompt(context)}

Return only a valid JSON array.`;
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
        },
        generateChatStream: async function* (history, message, transcript, handouts, options): AsyncGenerator<AiChatChunk> {
            const context = formatContext(transcript, handouts);
            const messages: OpenAiMessage[] = [
                { role: 'system', content: getChatSystemPrompt(context) },
                ...buildHistory(history),
                { role: 'user', content: message },
            ];
            const result = await callOpenAi(config, {
                model: selectModel(options),
                messages,
                temperature: 0.3,
            });
            const text = result.choices?.[0]?.message?.content ?? '';
            if (text) {
                yield { textDelta: text };
            }
        },
        editTranscript: async (text, mode, options) => {
            const prompt = getEditPrompt(mode, text, options?.customPrompt);
            const result = await callOpenAi(config, {
                model: selectModel(options),
                messages: [
                    { role: 'system', content: 'You faithfully transform text according to instructions.' },
                    { role: 'user', content: prompt },
                ],
                temperature: 0.2,
            });
            return result.choices?.[0]?.message?.content?.trim() ?? '';
        },
    };
};
