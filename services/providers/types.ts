import { GenerationMode, Flashcard, Handout, TranscriptSegment, ChatMessage, AiEditMode, GroundingSource } from '../../types';
import { ApiConfig, ProviderId } from '../../types/ai';

export interface ProviderMetadata {
    id: ProviderId;
    label: string;
    description: string;
    docsUrl: string;
    keyLabel: string;
    placeholder?: string;
    notes?: string;
    supportsLiveTranscription: boolean;
    allowsCustomBaseUrl?: boolean;
}

export interface AiChatChunk {
    textDelta: string;
    sources?: GroundingSource[];
}

export interface ProviderRuntimeOptions {
    useIntelligenceMode?: boolean;
    useSearchGrounding?: boolean;
    count?: number;
    customPrompt?: string;
}

export interface AiProvider {
    id: ProviderId;
    metadata: ProviderMetadata;
    processTranscript: (
        transcript: TranscriptSegment[],
        mode: GenerationMode,
        handouts: Handout[],
        options?: ProviderRuntimeOptions
    ) => Promise<string>;
    generateFlashcards: (
        transcript: TranscriptSegment[],
        handouts: Handout[],
        options?: ProviderRuntimeOptions
    ) => Promise<Flashcard[]>;
    generateTags: (
        transcript: TranscriptSegment[],
        handouts: Handout[]
    ) => Promise<string[]>;
    generateChatStream: (
        history: ChatMessage[],
        message: string,
        transcript: TranscriptSegment[],
        handouts: Handout[],
        options?: ProviderRuntimeOptions
    ) => AsyncGenerator<AiChatChunk>;
    editTranscript: (
        text: string,
        mode: AiEditMode,
        options?: ProviderRuntimeOptions
    ) => Promise<string>;
    rawConfig: ApiConfig;
}
