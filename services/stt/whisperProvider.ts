import { SttConfig, StreamingSttConfig, SttFinalResult, SttRecordedAudio, SttTranscriptResult } from '../../types/stt';
import { StreamingSttProvider, StreamingSttSession, StreamingSttCallbacks } from './types';
import { createSttError, SttError } from './errors';
import { httpFetch } from '../../utils/http';
import { logEvent } from '../../utils/logger';

// Talks to any OpenAI-compatible `/audio/transcriptions` endpoint: Groq's free tier, or a
// self-hosted open-source Whisper server (speaches / faster-whisper-server, LocalAI, whisper.cpp).
export const WHISPER_DEFAULT_BASE_URL = 'https://api.groq.com/openai/v1';
export const WHISPER_DEFAULT_MODEL = 'whisper-large-v3-turbo';

// Whisper has no streaming API, so live audio is sent in chunks. 8 s keeps Groq's free tier
// (20 requests/min) comfortable and gives the model enough context for accurate words.
const CHUNK_MS = 8000;
const MIN_CHUNK_MS = 700;
const MAX_BUFFER_MS = 60000;
// Whisper invents text ("Thank you.") on silence, so near-silent chunks are skipped.
const SILENCE_RMS = 200;
const RETRY_DELAY_MS = 2500;
const FINAL_FLUSH_TIMEOUT_MS = 15000;

interface WhisperSegment { text?: string; start?: number; end?: number }
interface WhisperResponse { text?: string; segments?: WhisperSegment[] }

const endpointFor = (config: SttConfig) =>
  `${(config.baseUrl?.trim() || WHISPER_DEFAULT_BASE_URL).replace(/\/$/, '')}/audio/transcriptions`;

// Whisper takes ISO-639-1 codes ("en"), not locales ("en-US").
export const toWhisperLanguage = (language?: string) => language?.trim().split(/[-_]/)[0].toLowerCase() || undefined;

export const encodeWav = (samples: Int16Array, sampleRate: number): Blob => {
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  const writeText = (offset: number, text: string) => [...text].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)));
  const dataBytes = samples.length * 2;
  writeText(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeText(8, 'WAVE');
  writeText(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeText(36, 'data');
  view.setUint32(40, dataBytes, true);
  return new Blob([header, samples.buffer as ArrayBuffer], { type: 'audio/wav' });
};

const rms = (samples: Int16Array) => {
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i];
  return samples.length ? Math.sqrt(sum / samples.length) : 0;
};

const asText = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

// Endpoints can be self-hosted, so the response shape is not trusted.
export const toSegments = (payload: WhisperResponse, offsetMs: number): SttFinalResult[] => {
  const segments: SttFinalResult[] = Array.isArray(payload?.segments) && payload.segments.length
    ? payload.segments.map(segment => ({
        text: asText(segment?.text),
        startMs: typeof segment?.start === 'number' ? offsetMs + Math.round(segment.start * 1000) : offsetMs,
        endMs: typeof segment?.end === 'number' ? offsetMs + Math.round(segment.end * 1000) : undefined,
        isFinal: true,
      }))
    : [{ text: asText(payload?.text), startMs: offsetMs, isFinal: true }];
  return segments.filter(segment => segment.text.length > 0);
};

const postAudio = async (config: SttConfig, file: Blob, filename: string, options: { language?: string; model?: string }) => {
  const form = new FormData();
  form.append('file', file, filename);
  form.append('model', options.model?.trim() || config.model?.trim() || WHISPER_DEFAULT_MODEL);
  form.append('response_format', 'verbose_json');
  const language = toWhisperLanguage(options.language ?? config.language);
  if (language) form.append('language', language);
  const response = await httpFetch(endpointFor(config), {
    method: 'POST',
    headers: config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : undefined,
    body: form,
  });
  if (response.status === 401 || response.status === 403) {
    throw createSttError('Authentication failed for the Whisper endpoint. Check your API key.', 'auth_failed', false, { status: response.status });
  }
  if (!response.ok) {
    throw createSttError(`Whisper endpoint returned ${response.status}.`, 'network_error', true, { status: response.status });
  }
  return (await response.json()) as WhisperResponse;
};

const createWhisperSession = (
  config: SttConfig,
  streamConfig: StreamingSttConfig,
  callbacks: StreamingSttCallbacks
): StreamingSttSession => {
  const sampleRate = streamConfig.sampleRate;
  let frames: Int16Array[] = [];
  let bufferedSamples = 0;
  let sentSamples = 0; // audio already handed off; timestamps segments from recording start
  let paused = false;
  let active = false;
  let timer: number | null = null;
  let queue: Promise<void> = Promise.resolve(); // keeps chunks in order

  const transcribeChunk = async (samples: Int16Array, offsetMs: number) => {
    if (rms(samples) < SILENCE_RMS) return;
    const wav = encodeWav(samples, sampleRate);
    const options = { language: streamConfig.language, model: streamConfig.model };
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const payload = await postAudio(config, wav, 'chunk.wav', options);
        toSegments(payload, offsetMs).forEach(segment => callbacks.onFinal(segment));
        return;
      } catch (error) {
        if ((error as SttError).code === 'auth_failed') {
          active = false;
          callbacks.onError(error as SttError);
          return;
        }
        if (attempt === 0) {
          await new Promise(resolve => window.setTimeout(resolve, RETRY_DELAY_MS));
        } else {
          // Not reported via onError: that would make the recorder open a second session.
          // The audio is still saved locally, so "Transcribe After Recording" can fill the gap.
          logEvent('warn', 'Whisper chunk failed; skipped', { offsetMs, message: error instanceof Error ? error.message : 'Unknown error' });
        }
      }
    }
  };

  const flush = (force = false) => {
    if (bufferedSamples === 0) return;
    if (!force && bufferedSamples < (sampleRate * MIN_CHUNK_MS) / 1000) return;
    const samples = new Int16Array(bufferedSamples);
    let offset = 0;
    frames.forEach(frame => { samples.set(frame, offset); offset += frame.length; });
    const offsetMs = Math.round((sentSamples / sampleRate) * 1000);
    sentSamples += bufferedSamples;
    frames = [];
    bufferedSamples = 0;
    queue = queue.then(() => transcribeChunk(samples, offsetMs));
  };

  const connect = async () => {
    if (active) return;
    active = true;
    timer = window.setInterval(() => flush(), CHUNK_MS);
    callbacks.onStateChange(paused ? 'paused' : 'connected');
  };

  const sendAudioFrame = (pcmFrame: Int16Array) => {
    if (!active || paused) return;
    frames.push(pcmFrame);
    bufferedSamples += pcmFrame.length;
    // If requests fall behind, drop the oldest audio rather than grow without bound.
    const maxSamples = (sampleRate * MAX_BUFFER_MS) / 1000;
    while (bufferedSamples > maxSamples && frames.length > 1) {
      const dropped = frames.shift()!;
      bufferedSamples -= dropped.length;
      sentSamples += dropped.length;
    }
  };

  const pause = () => {
    flush(true);
    paused = true;
    callbacks.onStateChange('paused');
  };

  const resume = () => {
    paused = false;
    callbacks.onStateChange(active ? 'connected' : 'connecting');
  };

  // Resolves after the last chunk is transcribed (or a timeout), so the caller can keep that text.
  const stop = async () => {
    if (timer) window.clearInterval(timer);
    timer = null;
    if (active) flush(true);
    active = false;
    await Promise.race([queue, new Promise(resolve => window.setTimeout(resolve, FINAL_FLUSH_TIMEOUT_MS))]);
    callbacks.onStateChange('closed');
  };

  return { connect, sendAudioFrame, pause, resume, stop };
};

export const createWhisperProvider = (config: SttConfig): StreamingSttProvider => ({
  createSession: (streamConfig, callbacks) => createWhisperSession(config, streamConfig, callbacks),
  transcribeAudio: async (audio: SttRecordedAudio, configOverride?: Pick<StreamingSttConfig, 'language' | 'model'>): Promise<SttTranscriptResult> => {
    const extension = audio.mimeType.includes('mp4') ? 'm4a' : audio.mimeType.includes('wav') ? 'wav' : 'webm';
    const payload = await postAudio(config, audio.blob, `recording.${extension}`, configOverride ?? {});
    return { text: asText(payload?.text), segments: toSegments(payload, 0) };
  },
});
