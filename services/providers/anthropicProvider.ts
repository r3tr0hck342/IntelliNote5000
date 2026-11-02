import Anthropic from '@anthropic-ai/sdk';
import { ChatMessage } from '../../types';
import { formatContext, getPromptForMode, getFlashcardPrompt, getTagPrompt, getChatSystemPrompt, getEditPrompt } from '../aiPrompts';
import { AiProvider, ProviderMetadata, ProviderRuntimeOptions, AiChatChunk } from './types';
import { ApiConfig } from '../../types/ai';
import { mapProviderError, ProviderError } from './errors';
import { httpFetch } from '../../utils/http';
import { dryRunMessage, parseFlashcards, parseTags, resolveModel } from './shared';

export const anthropicMetadata: ProviderMetadata = {
    id: 'anthropic',
    label: 'Anthropic Claude',
    description: 'Claude models via the Anthropic API.',
    docsUrl: 'https://platform.claude.com/docs/en/about-claude/models/overview',
    keyLabel: 'Anthropic API Key',
    notes: 'Intelligence Mode raises effort to "high". On newer models, a declined request is retried on a fallback model automatically.',
    supportsLiveTranscription: false,
    requiresApiKey: true,
    defaultModel: 'claude-opus-5-5',
    defaultAdvancedModel: 'claude-opus-5-5',
    suggestedModels: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-1'],
};

// Models that accept server-side refusal fallbacks (`fallbacks: "default"`).
const FALLBACK_MODELS = new Set(['claude-fable-5-1', 'claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5']);
const MAX_TOKENS = 16000;

export const createAnthropicProvider = (config: ApiConfig): AiProvider => {
    // The key belongs to the user and lives on their device, so browser use is intended.
    // baseURL is explicit so ANTHROPIC_* environment variables never redirect the request.
    const client = new Anthropic({
        apiKey: config.apiKey,
        baseURL: 'https://api.anthropic.com',
        dangerouslyAllowBrowser: true,
        fetch: httpFetch,
    });

    const buildParams = (system: string, messages: Anthropic.Beta.BetaMessageParam[], options?: ProviderRuntimeOptions) => {
        const model = resolveModel(config, anthropicMetadata, options);
        return {
            model,
            max_tokens: MAX_TOKENS,
            system,
            messages,
            ...(options?.useIntelligenceMode ? { output_config: { effort: 'high' as const } } : {}),
            ...(FALLBACK_MODELS.has(model)
                ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }
                : {}),
        };
    };

    const assertNotRefused = (stopReason: string | null) => {
        if (stopReason === 'refusal') {
            throw new ProviderError('Claude declined this request.', 'invalid_request', false, { provider: 'anthropic' });
        }
    };

    const complete = async (system: string, prompt: string, options?: ProviderRuntimeOptions): Promise<string> => {
        try {
            const response = await client.beta.messages.create(buildParams(system, [{ role: 'user', content: prompt }], options));
            assertNotRefused(response.stop_reason);
            return response.content.map(block => (block.type === 'text' ? block.text : '')).join('').trim();
        } catch (error) {
            throw mapProviderError(error, 'anthropic');
        }
    };

    const buildHistory = (history: ChatMessage[]): Anthropic.Beta.BetaMessageParam[] => history
        .filter(msg => msg.content.trim().length > 0) // the API rejects empty turns
        .map(msg => ({ role: msg.role === 'model' ? 'assistant' : 'user', content: msg.content }));

    return {
        id: 'anthropic',
        metadata: anthropicMetadata,
        rawConfig: config,
        processTranscript: async (transcript, mode, handouts, options) => {
            const prompt = getPromptForMode(mode, formatContext(transcript, handouts));
            if (options?.dryRun) return dryRunMessage('Claude', `process ${mode}`, prompt.length);
            return complete('You are an expert academic assistant.', prompt, options);
        },
        generateFlashcards: async (transcript, handouts, options) => {
            const count = options?.count ?? 10;
            const prompt = `${getFlashcardPrompt(formatContext(transcript, handouts), count)}

Return only a JSON array of objects with keys "front" and "back".`;
            if (options?.dryRun) {
                return Array.from({ length: count }, (_, index) => ({
                    front: `Dry run card ${index + 1}`,
                    back: dryRunMessage('Claude', 'flashcards', prompt.length),
                }));
            }
            return parseFlashcards(await complete('You create excellent study flashcards.', prompt, options));
        },
        generateTags: async (transcript, handouts, options) => {
            const prompt = `${getTagPrompt(formatContext(transcript, handouts))}

Return only a valid JSON array.`;
            if (options?.dryRun) return ['dry-run', `anthropic:${prompt.length}`];
            return parseTags(await complete('You extract concise topical tags.', prompt));
        },
        generateChatStream: async function* (history, message, transcript, handouts, options): AsyncGenerator<AiChatChunk> {
            const system = getChatSystemPrompt(formatContext(transcript, handouts));
            if (options?.dryRun) {
                const length = [system, message, ...history.map(item => item.content)].join('\n').length;
                yield { textDelta: dryRunMessage('Claude', 'chat', length) };
                return;
            }
            try {
                const stream = client.beta.messages.stream(
                    buildParams(system, [...buildHistory(history), { role: 'user', content: message }], options)
                );
                for await (const event of stream) {
                    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
                        yield { textDelta: event.delta.text };
                    }
                }
                assertNotRefused((await stream.finalMessage()).stop_reason);
            } catch (error) {
                throw mapProviderError(error, 'anthropic');
            }
        },
        editTranscript: async (text, mode, options) => {
            const prompt = getEditPrompt(mode, text, options?.customPrompt);
            if (options?.dryRun) return dryRunMessage('Claude', `edit ${mode}`, prompt.length);
            return complete('You faithfully transform text according to instructions.', prompt, options);
        },
    };
};
