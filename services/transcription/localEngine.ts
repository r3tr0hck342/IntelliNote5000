import { isTauri } from '../../utils/native';
import { logEvent } from '../../utils/logger';
import { parseTranscript, type Transcript } from './schema';
import type { EngineCaps, FileOptions, FileSource, ModelInfo, StreamHandle, StreamOptions, TranscriptionEngine } from './engine';

// Parakeet TDT 0.6B v3 languages (k2-fsa nemo-transducer-models page).
/** final = Parakeet (files, final pass), vad = Silero, live = Nemotron streaming. */
export type ModelRole = 'final' | 'vad' | 'live';

const PARAKEET_LANGUAGES = ['bg', 'hr', 'cs', 'da', 'nl', 'en', 'et', 'fi', 'fr', 'de', 'el', 'hu', 'it', 'lv', 'lt', 'mt', 'pl', 'pt', 'ro', 'sk', 'sl', 'es', 'sv', 'ru', 'uk'];

type SidecarEvent =
  | { type: 'status'; stage: 'transcribing' | 'converting' }
  | { type: 'progress'; processedSec: number; durationSec: number | null }
  | { type: 'download'; id: string; done: number; total: number }
  | { type: 'installed'; id: string }
  | { type: 'hello' };

/** Errors from the backend are short codes; this maps them to text a student can act on. */
export const describeTranscriptionError = (code: string): string => {
  switch (code) {
    case 'models_missing': return 'The speech models are not installed yet. Download them first.';
    case 'model_hash_mismatch':
    case 'file_hash_mismatch':
    case 'archive_hash_mismatch': return 'A speech model file failed its integrity check. Download the models again.';
    case 'audio_unsupported_no_ffmpeg': return 'This file format needs ffmpeg. Install ffmpeg, or convert the file to MP3, M4A, or WAV.';
    case 'audio_unsupported':
    case 'audio_corrupt':
    case 'ffmpeg_failed': return 'This file could not be decoded. Try converting it to MP3, M4A, or WAV.';
    case 'network_error': return 'The download was interrupted. Try again: it will resume where it stopped.';
    case 'sidecar_missing': return 'The on-device transcription component is missing from this install.';
    default: return 'On-device transcription failed. Please try again.';
  }
};

const invoke = async <T>(command: string, args?: Record<string, unknown>): Promise<T> =>
  (await import('@tauri-apps/api/core')).invoke<T>(command, args);

const createChannel = async (onMessage: (event: SidecarEvent) => void) => {
  const { Channel } = await import('@tauri-apps/api/core');
  const channel = new Channel<SidecarEvent>();
  channel.onmessage = onMessage;
  return channel;
};

export const localEngine: TranscriptionEngine & {
  installModels: (roles: ModelRole[], onProgress: (done: number, total: number) => void) => Promise<void>;
} = {
  startStream(_opts: StreamOptions): StreamHandle {
    throw new Error('Live on-device transcription is not available yet.');
  },

  async capabilities(): Promise<EngineCaps> {
    if (!isTauri()) return { available: false, models: [], languages: [] };
    const models = await invoke<ModelInfo[]>('transcription_models_status');
    return { available: true, models, languages: PARAKEET_LANGUAGES };
  },

  /** Downloads every missing model; progress covers all of them as one total. */
  async installModels(roles, onProgress) {
    const models = await invoke<ModelInfo[]>('transcription_models_status');
    const missing = models.filter(model => !model.installed && roles.includes(model.role as ModelRole));
    const total = missing.reduce((sum, model) => sum + model.downloadBytes, 0);
    const finished = new Map<string, number>();
    const channel = await createChannel(event => {
      if (event.type !== 'download') return;
      finished.set(event.id, event.done);
      onProgress([...finished.values()].reduce((sum, value) => sum + value, 0), total);
    });
    logEvent('info', 'Transcription models download started', { models: missing.length, bytes: total });
    await invoke('transcription_install_models', { roles, onEvent: channel });
    logEvent('info', 'Transcription models installed', { models: missing.length });
  },

  async transcribeFile(_source: FileSource, opts: FileOptions): Promise<Transcript | null> {
    const channel = await createChannel(event => {
      if (event.type === 'status') {
        opts.onProgress?.(event.stage === 'converting' ? { stage: 'converting' } : { stage: 'transcribing' });
      } else if (event.type === 'progress') {
        opts.onProgress?.({ stage: 'transcribing', processedSec: event.processedSec, durationSec: event.durationSec });
      }
    });
    const started = Date.now();
    const raw = await invoke<unknown>('transcription_pick_and_transcribe', { language: opts.language, onEvent: channel });
    if (raw === null) return null;
    const transcript = parseTranscript(raw);
    // Counts only: no transcript text or file paths in logs.
    logEvent('info', 'On-device file transcription finished', {
      segments: transcript.segments.length,
      elapsedMs: Date.now() - started,
      modelVersion: transcript.modelVersion,
    });
    return transcript;
  },
};
