import { SttConfig, SttRecordedAudio, SttTranscriptResult } from '../../types/stt';
import { StreamingSttProvider } from './types';
import { createDeepgramProvider } from './deepgramProvider';
import { createWhisperProvider, WHISPER_DEFAULT_BASE_URL, WHISPER_DEFAULT_MODEL } from './whisperProvider';

export interface SttProviderMetadata {
  id: SttConfig['provider'];
  label: string;
  description: string;
  docsUrl: string;
  keyLabel: string;
  placeholder?: string;
  notes?: string;
  /** Shown as a "Free" badge in Settings. */
  isFree?: boolean;
  requiresApiKey: boolean;
  allowsCustomBaseUrl?: boolean;
  defaultBaseUrl?: string;
  defaultModel: string;
  suggestedModels: string[];
  /** Word-by-word interim text, or text that arrives every few seconds. */
  liveMode: 'word-by-word' | 'chunked';
}

/** Presets for the Whisper endpoint field in Settings. */
export const WHISPER_ENDPOINT_PRESETS = [
  { label: 'Groq (free tier, cloud)', baseUrl: WHISPER_DEFAULT_BASE_URL, model: WHISPER_DEFAULT_MODEL },
  { label: 'Local Whisper server (speaches / faster-whisper)', baseUrl: 'http://localhost:8000/v1', model: 'Systran/faster-whisper-small' },
  { label: 'OpenAI (paid, no daily limit)', baseUrl: 'https://api.openai.com/v1', model: 'whisper-1' },
];

export const STT_PROVIDER_METADATA: Record<SttConfig['provider'], SttProviderMetadata> = {
  whisper: {
    id: 'whisper',
    label: 'Whisper (open source)',
    description: 'OpenAI\'s open-source Whisper model through any OpenAI-compatible endpoint: Groq\'s free tier, or your own local Whisper server for fully offline use.',
    docsUrl: 'https://console.groq.com/docs/speech-to-text',
    keyLabel: 'API Key (Groq key, or empty for a local server)',
    placeholder: 'gsk_… or leave empty for a local server',
    notes: 'Live text arrives in ~8 second chunks. Local server: `docker run -p 8000:8000 ghcr.io/speaches-ai/speaches:latest-cpu`.',
    isFree: true,
    requiresApiKey: false,
    allowsCustomBaseUrl: true,
    defaultBaseUrl: WHISPER_DEFAULT_BASE_URL,
    defaultModel: WHISPER_DEFAULT_MODEL,
    suggestedModels: ['whisper-large-v3-turbo', 'whisper-large-v3', 'Systran/faster-whisper-small', 'Systran/faster-distil-whisper-large-v3'],
    liveMode: 'chunked',
  },
  deepgram: {
    id: 'deepgram',
    label: 'Deepgram Streaming',
    description: 'Low-latency streaming transcription with interim results and word-level timing. Paid, with free starter credit.',
    docsUrl: 'https://developers.deepgram.com/docs/streaming',
    keyLabel: 'Deepgram API Key',
    placeholder: 'Paste your Deepgram API key',
    notes: 'Uses browser WebSocket streaming. Keep your key private.',
    requiresApiKey: true,
    defaultModel: 'nova-2',
    suggestedModels: ['nova-2', 'nova-3'],
    liveMode: 'word-by-word',
  },
};

export const isSttConfigReady = (config: SttConfig | null | undefined): config is SttConfig => {
  if (!config) return false;
  const metadata = STT_PROVIDER_METADATA[config.provider];
  if (!metadata) return false;
  return metadata.requiresApiKey ? config.apiKey.trim().length > 0 : true;
};

export const createStreamingSttProvider = (config: SttConfig): StreamingSttProvider => {
  switch (config.provider) {
    case 'whisper':
      return createWhisperProvider(config);
    case 'deepgram':
    default:
      return createDeepgramProvider(config);
  }
};

export const transcribeRecordedAudio = async (
  config: SttConfig,
  audio: SttRecordedAudio,
  options?: { language?: string; model?: string }
): Promise<SttTranscriptResult> => {
  const provider = createStreamingSttProvider(config);
  if (!provider.transcribeAudio) {
    throw new Error('Selected STT provider does not support prerecorded transcription.');
  }
  return provider.transcribeAudio(audio, { language: options?.language, model: options?.model });
};
