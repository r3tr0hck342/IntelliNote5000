import type { ApiConfig } from '../../types/ai';
import type { Flashcard } from '../../types';
import type { ProviderMetadata, ProviderRuntimeOptions } from './types';

export const resolveModel = (config: ApiConfig, metadata: ProviderMetadata, options?: ProviderRuntimeOptions): string =>
    options?.useIntelligenceMode
        ? config.advancedModel?.trim() || metadata.defaultAdvancedModel
        : config.model?.trim() || metadata.defaultModel;

export const dryRunMessage = (provider: string, action: string, payloadLength: number) =>
    `[Dry Run] ${provider} ${action} would send ${payloadLength} characters.`;

// Models without a JSON mode often wrap the array in ```json fences or add a sentence around it.
export const extractJsonArray = (text: string): unknown[] => {
    const unfenced = text.replace(/```(?:json)?/gi, '');
    const start = unfenced.indexOf('[');
    const end = unfenced.lastIndexOf(']');
    if (start === -1 || end <= start) {
        throw new Error('The model did not return a JSON array.');
    }
    const parsed: unknown = JSON.parse(unfenced.slice(start, end + 1));
    if (!Array.isArray(parsed)) throw new Error('The model did not return a JSON array.');
    return parsed;
};

export const parseFlashcards = (text: string): Flashcard[] =>
    extractJsonArray(text).filter((item): item is Flashcard =>
        !!item && typeof (item as Flashcard).front === 'string' && typeof (item as Flashcard).back === 'string');

export const parseTags = (text: string): string[] =>
    extractJsonArray(text).filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
