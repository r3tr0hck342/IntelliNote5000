import { SttConfig, StreamingSttConfig, SttFinalResult, SttInterimResult } from '../../types/stt';
import { StreamingSttProvider, StreamingSttSession } from './types';
import { createSttError, mapSttError } from './errors';

const buildDeepgramUrl = (config: StreamingSttConfig) => {
  const params = new URLSearchParams({
    encoding: 'linear16',
    channels: '1',
    sample_rate: config.sampleRate.toString(),
    punctuate: 'true',
    interim_results: config.enableInterimResults ? 'true' : 'false',
  });
  if (config.language) params.set('language', config.language);
  if (config.model) params.set('model', config.model);
  return `wss://api.deepgram.com/v1/listen?${params.toString()}`;
};

const parseResult = (payload: any): SttInterimResult | null => {
  if (!payload?.channel?.alternatives?.length) return null;
  const alternative = payload.channel.alternatives[0];
  if (!alternative?.transcript) return null;
  const words = alternative.words?.map((word: any) => ({
    word: word.word,
    startMs: word.start ? Math.round(word.start * 1000) : undefined,
    endMs: word.end ? Math.round(word.end * 1000) : undefined,
    confidence: word.confidence,
    speaker: word.speaker?.toString(),
  }));
  const startMs = words?.[0]?.startMs;
  const endMs = words?.[words.length - 1]?.endMs;
  return {
    text: alternative.transcript,
    confidence: alternative.confidence,
    startMs,
    endMs,
    words,
  };
};

export const createDeepgramProvider = (config: SttConfig): StreamingSttProvider => {
  return {
    start: async (streamConfig, callbacks): Promise<StreamingSttSession> => {
      const url = buildDeepgramUrl(streamConfig);
      const socket = new WebSocket(url, ['token', config.apiKey]);

      socket.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data as string);
          if (payload?.type && payload.type !== 'Results') return;
          const parsed = parseResult(payload);
          if (!parsed) return;
          if (payload.is_final) {
            callbacks.onFinal({ ...parsed, isFinal: true } as SttFinalResult);
          } else {
            callbacks.onInterim(parsed);
          }
        } catch (error) {
          callbacks.onError(mapSttError(error));
        }
      };

      socket.onerror = () => {
        callbacks.onError(createSttError('Deepgram connection error.', 'connection_failed', true));
      };

      socket.onclose = () => {
        callbacks.onClose();
      };

      const sendAudioFrame = (pcmFrame: Int16Array) => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(pcmFrame.buffer);
        }
      };

      const stop = async () => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'CloseStream' }));
        }
        socket.close();
      };

      return { sendAudioFrame, stop };
    },
  };
};
