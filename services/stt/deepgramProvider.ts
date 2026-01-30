import { SttConfig, StreamingSttConfig, SttFinalResult, SttInterimResult, SttRecordedAudio, SttTranscriptResult } from '../../types/stt';
import { StreamingSttProvider, StreamingSttSession, StreamingSttCallbacks } from './types';
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
  const utteranceId = payload?.utterance_id ?? payload?.metadata?.utterance_id;
  return {
    text: alternative.transcript,
    confidence: alternative.confidence,
    startMs,
    endMs,
    words,
    utteranceId: utteranceId ? String(utteranceId) : undefined,
  };
};

const parseRecordedTranscript = (payload: any): SttTranscriptResult => {
  const alternative = payload?.results?.channels?.[0]?.alternatives?.[0];
  const transcript = alternative?.transcript ?? '';
  const paragraphs = alternative?.paragraphs?.paragraphs ?? [];
  const segments: SttFinalResult[] = paragraphs.length
    ? paragraphs.map((paragraph: any) => ({
        text: paragraph.sentences?.map((sentence: any) => sentence.text).join(' ') ?? paragraph.text ?? '',
        startMs: paragraph.start ? Math.round(paragraph.start * 1000) : undefined,
        endMs: paragraph.end ? Math.round(paragraph.end * 1000) : undefined,
        confidence: paragraph.confidence,
        words: paragraph.words?.map((word: any) => ({
          word: word.word,
          startMs: word.start ? Math.round(word.start * 1000) : undefined,
          endMs: word.end ? Math.round(word.end * 1000) : undefined,
          confidence: word.confidence,
          speaker: word.speaker?.toString(),
        })),
        utteranceId: paragraph.id ? String(paragraph.id) : undefined,
        isFinal: true,
      }))
    : transcript
      ? [
          {
            text: transcript,
            confidence: alternative?.confidence,
            words: alternative?.words?.map((word: any) => ({
              word: word.word,
              startMs: word.start ? Math.round(word.start * 1000) : undefined,
              endMs: word.end ? Math.round(word.end * 1000) : undefined,
              confidence: word.confidence,
              speaker: word.speaker?.toString(),
            })),
            isFinal: true,
          },
        ]
      : [];
  return { text: transcript, segments };
};

const buildRecordedUrl = (config?: Pick<StreamingSttConfig, 'language' | 'model'>) => {
  const params = new URLSearchParams({
    punctuate: 'true',
    paragraphs: 'true',
  });
  if (config?.language) params.set('language', config.language);
  if (config?.model) params.set('model', config.model);
  return `https://api.deepgram.com/v1/listen?${params.toString()}`;
};

const createDeepgramSession = (
  config: SttConfig,
  streamConfig: StreamingSttConfig,
  callbacks: StreamingSttCallbacks
): StreamingSttSession => {
  let socket: WebSocket | null = null;
  let paused = false;

  const connect = async () => {
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
      return;
    }
    callbacks.onStateChange('connecting');
    const url = buildDeepgramUrl(streamConfig);
    socket = new WebSocket(url, ['token', config.apiKey]);

    socket.onopen = () => {
      callbacks.onStateChange(paused ? 'paused' : 'connected');
    };

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
      callbacks.onStateChange('closed');
    };
  };

  const sendAudioFrame = (pcmFrame: Int16Array) => {
    if (!socket || paused) return;
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(pcmFrame.buffer);
    }
  };

  const pause = () => {
    paused = true;
    callbacks.onStateChange('paused');
  };

  const resume = () => {
    paused = false;
    callbacks.onStateChange(socket?.readyState === WebSocket.OPEN ? 'connected' : 'connecting');
  };

  const stop = async () => {
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'CloseStream' }));
    }
    socket?.close();
    socket = null;
    callbacks.onStateChange('closed');
  };

  return { connect, sendAudioFrame, pause, resume, stop };
};

export const createDeepgramProvider = (config: SttConfig): StreamingSttProvider => {
  return {
    createSession: (streamConfig, callbacks) => createDeepgramSession(config, streamConfig, callbacks),
    transcribeAudio: async (audio: SttRecordedAudio, configOverride?: Pick<StreamingSttConfig, 'language' | 'model'>) => {
      const response = await fetch(buildRecordedUrl(configOverride), {
        method: 'POST',
        headers: {
          Authorization: `Token ${config.apiKey}`,
          'Content-Type': audio.mimeType,
        },
        body: audio.blob,
      });
      if (!response.ok) {
        throw createSttError('Failed to transcribe recorded audio.', response.status === 401 ? 'auth_failed' : 'network_error', true);
      }
      const payload = await response.json();
      return parseRecordedTranscript(payload);
    },
  };
};
