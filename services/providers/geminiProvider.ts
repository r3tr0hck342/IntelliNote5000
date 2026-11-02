import { GoogleGenAI, Type, type Content } from "@google/genai";
import { GenerationMode, Flashcard, Handout, TranscriptSegment, ChatMessage, AiEditMode, GroundingSource } from '../../types';
import { formatContext, getPromptForMode, getFlashcardPrompt, getTagPrompt, getChatSystemPrompt, getEditPrompt } from '../aiPrompts';
import { AiProvider, ProviderMetadata, ProviderRuntimeOptions, AiChatChunk } from './types';
import { ApiConfig } from '../../utils/apiConfig';
import { mapProviderError } from './errors';
import { resolveModel } from './shared';

export const geminiMetadata: ProviderMetadata = {
    id: 'gemini',
    label: 'Google Gemini',
    description: 'Gemini models with a Google AI Studio key. The free tier covers the Flash models; chat can also search the web.',
    docsUrl: 'https://ai.google.dev/gemini-api/docs/models',
    keyLabel: 'Gemini API Key',
    notes: 'Get a free key at aistudio.google.com. Pro models have much lower free limits than Flash.',
    supportsLiveTranscription: false,
    isFree: true,
    requiresApiKey: true,
    defaultModel: 'gemini-flash-lite-latest',
    defaultAdvancedModel: 'gemini-2.5-pro',
    suggestedModels: ['gemini-flash-lite-latest', 'gemini-flash-latest', 'gemini-2.5-flash-lite', 'gemini-2.5-flash', 'gemini-2.5-pro'],
};

// Chat used a slightly stronger default than the bulk generators before models became configurable.
const DEFAULT_CHAT_MODEL = 'gemini-2.5-flash';

export const createGeminiProvider = (config: ApiConfig): AiProvider => {
    const client = new GoogleGenAI({ apiKey: config.apiKey });

    const selectModel = (options?: ProviderRuntimeOptions) => resolveModel(config, geminiMetadata, options);

    // A 32768-token thinking budget is only valid on Pro models; other models keep their default.
    const withThinkingConfig = (model: string, options?: ProviderRuntimeOptions) =>
        options?.useIntelligenceMode && model.includes('pro') ? { thinkingConfig: { thinkingBudget: 32768 } } : {};

    return {
        id: 'gemini',
        metadata: geminiMetadata,
        rawConfig: config,
        processTranscript: async (transcript: TranscriptSegment[], mode: GenerationMode, handouts: Handout[], options?: ProviderRuntimeOptions): Promise<string> => {
            try {
                const context = formatContext(transcript, handouts);
                const prompt = getPromptForMode(mode, context);
                if (options?.dryRun) {
                    return `[Dry Run] Gemini process ${mode} would send ${prompt.length} characters.`;
                }
                const model = selectModel(options);
                const response = await client.models.generateContent({
                    model,
                    contents: prompt,
                    config: withThinkingConfig(model, options)
                });
                return response.text;
            } catch (error) {
                throw mapProviderError(error, 'gemini');
            }
        },
        generateFlashcards: async (transcript: TranscriptSegment[], handouts: Handout[], options?: ProviderRuntimeOptions): Promise<Flashcard[]> => {
            try {
                const count = options?.count ?? 10;
                const context = formatContext(transcript, handouts);
                const prompt = getFlashcardPrompt(context, count);
                if (options?.dryRun) {
                    return Array.from({ length: count }, (_, index) => ({
                        front: `Dry run card ${index + 1}`,
                        back: `[Dry Run] Gemini flashcards would send ${prompt.length} characters.`,
                    }));
                }
                const model = selectModel(options);
                const response = await client.models.generateContent({
                    model,
                    contents: prompt,
                    config: {
                        responseMimeType: "application/json",
                        responseSchema: {
                            type: Type.ARRAY,
                            items: {
                                type: Type.OBJECT,
                                properties: {
                                    front: { type: Type.STRING },
                                    back: { type: Type.STRING }
                                },
                                required: ['front', 'back']
                            }
                        },
                        ...withThinkingConfig(model, options),
                    }
                });
                const jsonText = response.text.trim();
                return JSON.parse(jsonText);
            } catch (error) {
                throw mapProviderError(error, 'gemini');
            }
        },
        generateTags: async (transcript: TranscriptSegment[], handouts: Handout[], options?: ProviderRuntimeOptions): Promise<string[]> => {
            try {
                const context = formatContext(transcript, handouts);
                const prompt = getTagPrompt(context);
                if (options?.dryRun) {
                    return ['dry-run', `gemini:${prompt.length}`];
                }
                const response = await client.models.generateContent({
                    model: selectModel(),
                    contents: prompt,
                    config: {
                        responseMimeType: "application/json",
                        responseSchema: { type: Type.ARRAY, items: { type: Type.STRING } }
                    }
                });
                const jsonText = response.text.trim();
                return JSON.parse(jsonText);
            } catch (error) {
                throw mapProviderError(error, 'gemini');
            }
        },
        generateChatStream: async function* (history: ChatMessage[], message: string, transcript: TranscriptSegment[], handouts: Handout[], options?: ProviderRuntimeOptions): AsyncGenerator<AiChatChunk> {
            try {
                const context = formatContext(transcript, handouts);
                if (options?.dryRun) {
                    const payloadLength = [getChatSystemPrompt(context), message, ...history.map(item => item.content)].join('\n').length;
                    yield { textDelta: `[Dry Run] Gemini chat would send ${payloadLength} characters.` };
                    return;
                }
                const contents: Content[] = [
                    ...history.map(msg => ({
                        role: msg.role,
                        parts: [{ text: msg.content }]
                    })),
                    { role: 'user', parts: [{ text: message }] }
                ];

                const model = options?.useIntelligenceMode || config.model?.trim()
                    ? selectModel(options)
                    : DEFAULT_CHAT_MODEL;
                const stream = await client.models.generateContentStream({
                    model,
                    contents,
                    config: {
                        systemInstruction: getChatSystemPrompt(context),
                        tools: options?.useSearchGrounding ? [{ googleSearch: {} }] : undefined,
                        ...withThinkingConfig(model, options),
                    }
                });

                for await (const chunk of stream) {
                    const sources = chunk.candidates?.[0]?.groundingMetadata?.groundingChunks
                        ?.map(c => c.web && { uri: c.web.uri, title: c.web.title })
                        .filter((s): s is GroundingSource => !!s?.uri);
                    if (chunk.text) {
                        yield {
                            textDelta: chunk.text,
                            sources: sources && sources.length > 0 ? sources : undefined,
                        };
                    }
                }
            } catch (error) {
                throw mapProviderError(error, 'gemini');
            }
        },
        editTranscript: async (text: string, mode: AiEditMode, options?: ProviderRuntimeOptions): Promise<string> => {
            try {
                const prompt = getEditPrompt(mode, text, options?.customPrompt);
                if (options?.dryRun) {
                    return `[Dry Run] Gemini edit ${mode} would send ${prompt.length} characters.`;
                }
                const model = selectModel(options);
                const response = await client.models.generateContent({
                    model,
                    contents: prompt,
                    config: withThinkingConfig(model, options)
                });
                return response.text;
            } catch (error) {
                throw mapProviderError(error, 'gemini');
            }
        }
    };
};
