import { GoogleGenAI, Type } from "@google/genai";
import { GenerationMode, Flashcard, Handout, TranscriptSegment, ChatMessage, AiEditMode, GroundingSource } from '../../types';
import { formatContext, getPromptForMode, getFlashcardPrompt, getTagPrompt, getChatSystemPrompt, getEditPrompt } from '../aiPrompts';
import { AiProvider, ProviderMetadata, ProviderRuntimeOptions, AiChatChunk } from './types';
import { ApiConfig } from '../../utils/apiConfig';

export const geminiMetadata: ProviderMetadata = {
    id: 'gemini',
    label: 'Google Gemini',
    description: 'Use Google AI Studio API keys to access Gemini 2.0/2.5 models.',
    docsUrl: 'https://ai.google.dev/gemini-api/docs',
    keyLabel: 'Gemini API Key',
    notes: 'Great for multimodal AI outputs and long-context study workflows.',
    supportsLiveTranscription: false,
};

export const createGeminiProvider = (config: ApiConfig): AiProvider => {
    const client = new GoogleGenAI({ apiKey: config.apiKey });

    const withThinkingConfig = (options?: ProviderRuntimeOptions) => {
        if (options?.useIntelligenceMode) {
            return { thinkingConfig: { thinkingBudget: 32768 } };
        }
        return {};
    };

    const selectModel = (lightweight: string, advanced: string, options?: ProviderRuntimeOptions) =>
        options?.useIntelligenceMode ? advanced : lightweight;

    return {
        id: 'gemini',
        metadata: geminiMetadata,
        rawConfig: config,
        processTranscript: async (transcript: TranscriptSegment[], mode: GenerationMode, handouts: Handout[], options?: ProviderRuntimeOptions): Promise<string> => {
            const context = formatContext(transcript, handouts);
            const prompt = getPromptForMode(mode, context);
            const response = await client.models.generateContent({
                model: selectModel('gemini-flash-lite-latest', 'gemini-2.5-pro', options),
                contents: prompt,
                config: withThinkingConfig(options)
            });
            return response.text;
        },
        generateFlashcards: async (transcript: TranscriptSegment[], handouts: Handout[], options?: ProviderRuntimeOptions): Promise<Flashcard[]> => {
            const count = options?.count ?? 10;
            const context = formatContext(transcript, handouts);
            const prompt = getFlashcardPrompt(context, count);
            const response = await client.models.generateContent({
                model: selectModel('gemini-flash-lite-latest', 'gemini-2.5-pro', options),
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
                    ...withThinkingConfig(options),
                }
            });
            const jsonText = response.text.trim();
            return JSON.parse(jsonText);
        },
        generateTags: async (transcript: TranscriptSegment[], handouts: Handout[]): Promise<string[]> => {
            const context = formatContext(transcript, handouts);
            const prompt = getTagPrompt(context);
            const response = await client.models.generateContent({
                model: 'gemini-flash-lite-latest',
                contents: prompt,
                config: {
                    responseMimeType: "application/json",
                    responseSchema: { type: Type.ARRAY, items: { type: Type.STRING } }
                }
            });
            const jsonText = response.text.trim();
            return JSON.parse(jsonText);
        },
        generateChatStream: async function* (history: ChatMessage[], message: string, transcript: TranscriptSegment[], handouts: Handout[], options?: ProviderRuntimeOptions): AsyncGenerator<AiChatChunk> {
            const context = formatContext(transcript, handouts);
            const contents = [
                ...history.map(msg => ({
                    role: msg.role,
                    parts: [{ text: msg.content }]
                })),
                { role: 'user', parts: [{ text: message }] }
            ];

            const stream = await client.models.generateContentStream({
                model: selectModel('gemini-2.5-flash', 'gemini-2.5-pro', options),
                contents: contents as any,
                config: {
                    systemInstruction: getChatSystemPrompt(context),
                    tools: options?.useSearchGrounding ? [{ googleSearch: {} }] : undefined,
                    ...withThinkingConfig(options),
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
        },
        editTranscript: async (text: string, mode: AiEditMode, options?: ProviderRuntimeOptions): Promise<string> => {
            const prompt = getEditPrompt(mode, text, options?.customPrompt);
            const response = await client.models.generateContent({
                model: selectModel('gemini-flash-lite-latest', 'gemini-2.5-pro', options),
                contents: prompt,
                config: withThinkingConfig(options)
            });
            return response.text;
        }
    };
};
