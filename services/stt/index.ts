import { SttConfig, SttRecordedAudio, SttTranscriptResult } from '../../types/stt';
import { StreamingSttProvider } from './types';
import { createDeepgramProvider } from './deepgramProvider';

export interface SttProviderMetadata {
  id: SttConfig['provider'];
  label: string;
  description: string;
  docsUrl: string;
  keyLabel: string;
  placeholder?: string;
  notes?: string;
}

export const STT_PROVIDER_METADATA: Record<SttConfig['provider'], SttProviderMetadata> = {
  deepgram: {
    id: 'deepgram',
    label: 'Deepgram Streaming',
    description: 'Low-latency streaming transcription with interim results and word-level timing.',
    docsUrl: 'https://developers.deepgram.com/docs/streaming',
    keyLabel: 'Deepgram API Key',
    placeholder: 'Paste your Deepgram API key',
    notes: 'Uses browser WebSocket streaming. Keep your key private.',
  },
};

export const createStreamingSttProvider = (config: SttConfig): StreamingSttProvider => {
  switch (config.provider) {
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
