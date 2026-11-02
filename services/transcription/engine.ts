import type { Transcript } from './schema';

// One interface for every transcription engine. `LocalSherpaEngine` (on-device, desktop) is the
// only implementation today; a remote engine would sit behind an explicit opt-in.

export interface StreamOptions {
  language: string;
  hotwords?: string[];
  chunkMs: 560 | 1120;
}

/** Live streaming arrives in Phase 2. */
export interface StreamHandle {
  stop: () => Promise<void>;
}

/**
 * Where the audio comes from. The local engine only accepts `picker`: the native file dialog is
 * opened by the app backend so the UI never hands it a filesystem path.
 */
export type FileSource = { kind: 'picker' };

export interface FileOptions {
  language: string;
  onProgress?: (progress: TranscriptionProgress) => void;
}

export type TranscriptionProgress =
  | { stage: 'converting' }
  | { stage: 'transcribing'; processedSec?: number; durationSec?: number | null };

export interface ModelInfo {
  id: string;
  role: string;
  installed: boolean;
  downloadBytes: number;
  license: string;
  attribution: string;
}

export interface EngineCaps {
  available: boolean;
  models: ModelInfo[];
  languages: string[];
}

export interface TranscriptionEngine {
  startStream(opts: StreamOptions): StreamHandle;
  /** Resolves `null` if the user cancels the file picker. */
  transcribeFile(source: FileSource, opts: FileOptions): Promise<Transcript | null>;
  capabilities(): Promise<EngineCaps>;
}
