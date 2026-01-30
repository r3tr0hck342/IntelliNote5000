import { GenerationMode, Flashcard, Handout, TranscriptSegment, ChatMessage, AiEditMode } from '../types';
import { getRequiredApiConfig } from '../utils/env';
import { createProvider } from './providers';
import { AiChatChunk } from './providers/types';
import { mapProviderError, getProviderErrorSummary } from './providers/errors';
import { pushToast } from '../utils/toastStore';
import { logEvent } from '../utils/logger';
import type { ProviderId } from '../types/ai';

const getProvider = () => {
    const config = getRequiredApiConfig();
    return createProvider(config);
};

interface AiRequestOptions<T> {
    onRetrySuccess?: (result: T) => void | Promise<void>;
}

const runAiRequest = async <T>(
    label: string,
    providerId: ProviderId,
    action: () => Promise<T>,
    options?: AiRequestOptions<T>
): Promise<T> => {
    logEvent('info', `${label} started`, { provider: providerId });
    try {
        const result = await action();
        logEvent('info', `${label} completed`, { provider: providerId });
        return result;
    } catch (error) {
        const providerError = mapProviderError(error, providerId);
        logEvent('error', `${label} failed`, { provider: providerId, code: providerError.code, retryable: providerError.retryable });
        pushToast({
            title: `${getProviderErrorSummary(providerError)} while ${label.toLowerCase()}`,
            description: providerError.message,
            variant: 'error',
            action: providerError.retryable
                ? {
                    label: 'Retry',
                    onAction: async () => {
                        const retryResult = await runAiRequest(label, providerId, action, options);
                        await options?.onRetrySuccess?.(retryResult);
                    },
                }
                : undefined,
        });
        throw providerError;
    }
};

export const processTranscript = async (
    transcript: TranscriptSegment[],
    mode: GenerationMode,
    handouts: Handout[],
    useIntelligenceMode: boolean,
    options?: AiRequestOptions<string>
): Promise<string> => {
    const provider = getProvider();
    return runAiRequest(
        'Transcript processing',
        provider.id,
        () => provider.processTranscript(transcript, mode, handouts, { useIntelligenceMode }),
        options
    );
};

export const generateFlashcards = async (
    transcript: TranscriptSegment[],
    handouts: Handout[],
    count: number,
    useIntelligenceMode: boolean,
    options?: AiRequestOptions<Flashcard[]>
): Promise<Flashcard[]> => {
    const provider = getProvider();
    return runAiRequest(
        'Flashcard generation',
        provider.id,
        () => provider.generateFlashcards(transcript, handouts, { count, useIntelligenceMode }),
        options
    );
};

export const generateTags = async (
    transcript: TranscriptSegment[],
    handouts: Handout[],
    options?: AiRequestOptions<string[]>
): Promise<string[]> => {
    const provider = getProvider();
    return runAiRequest(
        'Tag generation',
        provider.id,
        () => provider.generateTags(transcript, handouts),
        options
    );
};

export const getChatResponseStream = async (
    history: ChatMessage[],
    message: string,
    transcript: TranscriptSegment[],
    handouts: Handout[],
    useSearchGrounding: boolean,
    useIntelligenceMode: boolean,
    options?: AiRequestOptions<AsyncGenerator<AiChatChunk>>
): Promise<AsyncGenerator<AiChatChunk>> => {
    const provider = getProvider();
    return runAiRequest(
        'Chat response',
        provider.id,
        () => provider.generateChatStream(history, message, transcript, handouts, {
            useSearchGrounding,
            useIntelligenceMode,
        }),
        options
    );
};

export const editTranscriptWithAi = async (
    text: string,
    mode: AiEditMode,
    useIntelligenceMode: boolean,
    customPrompt?: string,
    options?: AiRequestOptions<string>
): Promise<string> => {
    const provider = getProvider();
    return runAiRequest(
        'Transcript edit',
        provider.id,
        () => provider.editTranscript(text, mode, { useIntelligenceMode, customPrompt }),
        options
    );
};
