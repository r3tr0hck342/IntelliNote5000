import { GenerationMode, Flashcard, Handout, TranscriptSegment, ChatMessage, AiEditMode } from '../types';
import { getActiveApiConfig, getRequiredApiConfig } from '../utils/env';
import { createProvider, DEFAULT_PROVIDER_ID } from './providers';
import { AiChatChunk } from './providers/types';
import { mapProviderError, getProviderErrorSummary } from './providers/errors';
import { pushToast } from '../utils/toastStore';
import { logEvent } from '../utils/logger';
import type { ProviderId } from '../types/ai';
import type { AiProvider, ProviderRuntimeOptions } from './providers/types';

const getProvider = (options?: { allowMissingKey?: boolean; providerId?: ProviderId }): AiProvider => {
    if (options?.allowMissingKey) {
        const activeConfig = getActiveApiConfig();
        if (activeConfig?.apiKey) {
            return createProvider(activeConfig);
        }
        const fallbackProviderId = options?.providerId ?? DEFAULT_PROVIDER_ID;
        return createProvider({ provider: fallbackProviderId, apiKey: 'dry-run' });
    }
    const config = getRequiredApiConfig();
    return createProvider(config);
};

interface AiRequestOptions<T> {
    onRetrySuccess?: (result: T) => void | Promise<void>;
    dryRun?: boolean;
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
    const provider = getProvider({ allowMissingKey: options?.dryRun });
    return runAiRequest(
        'Transcript processing',
        provider.id,
        () => provider.processTranscript(transcript, mode, handouts, { useIntelligenceMode, dryRun: options?.dryRun }),
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
    const provider = getProvider({ allowMissingKey: options?.dryRun });
    return runAiRequest(
        'Flashcard generation',
        provider.id,
        () => provider.generateFlashcards(transcript, handouts, { count, useIntelligenceMode, dryRun: options?.dryRun }),
        options
    );
};

export const generateTags = async (
    transcript: TranscriptSegment[],
    handouts: Handout[],
    options?: AiRequestOptions<string[]>
): Promise<string[]> => {
    const provider = getProvider({ allowMissingKey: options?.dryRun });
    return runAiRequest(
        'Tag generation',
        provider.id,
        () => provider.generateTags(transcript, handouts, { dryRun: options?.dryRun }),
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
    const provider = getProvider({ allowMissingKey: options?.dryRun });
    return runAiRequest(
        'Chat response',
        provider.id,
        () => provider.generateChatStream(history, message, transcript, handouts, {
            useSearchGrounding,
            useIntelligenceMode,
            dryRun: options?.dryRun,
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
    const provider = getProvider({ allowMissingKey: options?.dryRun });
    return runAiRequest(
        'Transcript edit',
        provider.id,
        () => provider.editTranscript(text, mode, { useIntelligenceMode, customPrompt, dryRun: options?.dryRun }),
        options
    );
};

export interface DryRunPipelineRequest {
    sessionId: string;
    assetId: string;
    transcript: TranscriptSegment[];
    handouts: Handout[];
    chatHistory?: ChatMessage[];
    chatMessage?: string;
    useIntelligenceMode?: boolean;
    providerId?: ProviderId;
}

export interface DryRunGeneratorResult {
    id: string;
    detail: string;
}

export interface DryRunPipelineResult {
    providerId: ProviderId;
    validation: {
        missingFields: string[];
        sessionId: string;
        assetId: string;
        transcriptSegments: number;
        handoutCount: number;
    };
    generators: DryRunGeneratorResult[];
}

const buildRuntimeOptions = (request: DryRunPipelineRequest): ProviderRuntimeOptions => ({
    useIntelligenceMode: request.useIntelligenceMode,
    dryRun: true,
});

export const runDryRunPipeline = async (
    request: DryRunPipelineRequest,
    options?: { providerOverride?: AiProvider }
): Promise<DryRunPipelineResult> => {
    const missingFields: string[] = [];
    if (!request.sessionId) missingFields.push('sessionId');
    if (!request.assetId) missingFields.push('assetId');
    if (!request.transcript || request.transcript.length === 0) missingFields.push('transcript');

    const provider = options?.providerOverride
        ?? getProvider({ allowMissingKey: true, providerId: request.providerId });
    const runtimeOptions = buildRuntimeOptions(request);
    const transcript = request.transcript.filter(segment => segment.isFinal);
    const handouts = request.handouts;
    const chatHistory = request.chatHistory ?? [];
    const chatMessage = request.chatMessage ?? 'Run a dry-run chat response to validate wiring.';

    const generators: DryRunGeneratorResult[] = [];
    const notes = await provider.processTranscript(transcript, GenerationMode.Notes, handouts, runtimeOptions);
    generators.push({ id: 'notes', detail: notes });

    const tags = await provider.generateTags(transcript, handouts, runtimeOptions);
    generators.push({ id: 'tags', detail: `Tags: ${tags.join(', ')}` });

    const studyGuide = await provider.processTranscript(transcript, GenerationMode.StudyGuide, handouts, runtimeOptions);
    generators.push({ id: 'study-guide', detail: studyGuide });

    const testQuestions = await provider.processTranscript(transcript, GenerationMode.TestQuestions, handouts, runtimeOptions);
    generators.push({ id: 'test-questions', detail: testQuestions });

    const flashcards = await provider.generateFlashcards(transcript, handouts, {
        ...runtimeOptions,
        count: 10,
    });
    generators.push({ id: 'flashcards', detail: `Flashcards: ${flashcards.length}` });

    const chatStream = await provider.generateChatStream(chatHistory, chatMessage, transcript, handouts, runtimeOptions);
    let chatPreview = '';
    for await (const chunk of chatStream) {
        chatPreview += chunk.textDelta;
    }
    generators.push({ id: 'chat', detail: chatPreview || 'Chat stream completed with no content.' });

    return {
        providerId: provider.id,
        validation: {
            missingFields,
            sessionId: request.sessionId,
            assetId: request.assetId,
            transcriptSegments: transcript.length,
            handoutCount: handouts.length,
        },
        generators,
    };
};
