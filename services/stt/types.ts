import { StreamingSttConfig, SttInterimResult, SttFinalResult, SttRecordedAudio, SttTranscriptResult } from '../../types/stt';
import type { SttError } from './errors';

export type StreamingSttState = 'idle' | 'connecting' | 'connected' | 'paused' | 'closed';

export interface StreamingSttCallbacks {
  onInterim: (result: SttInterimResult) => void;
  onFinal: (result: SttFinalResult) => void;
  onError: (error: SttError) => void;
  onStateChange: (state: StreamingSttState) => void;
  onSocketClose?: (event: CloseEvent) => void;
}

export interface StreamingSttSession {
  connect: () => Promise<void>;
  sendAudioFrame: (pcmFrame: Int16Array) => void;
  pause: () => void;
  resume: () => void;
  stop: () => Promise<void>;
}

export interface StreamingSttProvider {
  createSession: (config: StreamingSttConfig, callbacks: StreamingSttCallbacks) => StreamingSttSession;
  transcribeAudio?: (audio: SttRecordedAudio, config?: Pick<StreamingSttConfig, 'language' | 'model'>) => Promise<SttTranscriptResult>;
}
