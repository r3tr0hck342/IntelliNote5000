import { GenerationMode, Flashcard, Handout, TranscriptSegment, ChatMessage, AiEditMode } from '../types';
import { getRequiredApiConfig } from '../utils/env';
import { createProvider } from './providers';
import { ProviderRuntimeOptions, AiChatChunk } from './providers/types';

const getProvider = () => {
    const config = getRequiredApiConfig();
    return createProvider(config);
};

export const processTranscript = async (
    transcript: TranscriptSegment[],
    mode: GenerationMode,
    handouts: Handout[],
    useIntelligenceMode: boolean
): Promise<string> => {
    const provider = getProvider();
    return provider.processTranscript(transcript, mode, handouts, { useIntelligenceMode });
};

export const generateFlashcards = async (
    transcript: TranscriptSegment[],
    handouts: Handout[],
    count: number,
    useIntelligenceMode: boolean
): Promise<Flashcard[]> => {
    const provider = getProvider();
    return provider.generateFlashcards(transcript, handouts, { count, useIntelligenceMode });
};

export const generateTags = async (
    transcript: TranscriptSegment[],
    handouts: Handout[]
): Promise<string[]> => {
    const provider = getProvider();
    return provider.generateTags(transcript, handouts);
};

export const getChatResponseStream = async (
    history: ChatMessage[],
    message: string,
    transcript: TranscriptSegment[],
    handouts: Handout[],
    useSearchGrounding: boolean,
    useIntelligenceMode: boolean
): Promise<AsyncGenerator<AiChatChunk>> => {
    const provider = getProvider();
    return provider.generateChatStream(history, message, transcript, handouts, {
        useSearchGrounding,
        useIntelligenceMode,
    });
};

export const editTranscriptWithAi = async (
    text: string,
    mode: AiEditMode,
    useIntelligenceMode: boolean,
    customPrompt?: string
): Promise<string> => {
    const provider = getProvider();
    return provider.editTranscript(text, mode, { useIntelligenceMode, customPrompt });
};
