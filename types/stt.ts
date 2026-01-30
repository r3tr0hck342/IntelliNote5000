export type SttProviderId = 'deepgram';

export interface SttConfig {
  provider: SttProviderId;
  apiKey: string;
  language?: string;
  model?: string;
}

export interface StreamingSttConfig {
  sampleRate: number;
  language?: string;
  model?: string;
  enableInterimResults?: boolean;
}

export interface SttWord {
  word: string;
  startMs?: number;
  endMs?: number;
  confidence?: number;
  speaker?: string;
}

export interface SttInterimResult {
  text: string;
  startMs?: number;
  endMs?: number;
  confidence?: number;
  words?: SttWord[];
  utteranceId?: string;
}

export interface SttFinalResult extends SttInterimResult {
  isFinal: true;
}

export interface SttTranscriptResult {
  text: string;
  segments: SttFinalResult[];
}

export interface SttRecordedAudio {
  blob: Blob;
  mimeType: string;
  sampleRate?: number;
}
