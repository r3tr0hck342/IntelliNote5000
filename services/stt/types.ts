import { StreamingSttConfig, SttInterimResult, SttFinalResult } from '../../types/stt';
import type { SttError } from './errors';

export interface StreamingSttSession {
  sendAudioFrame: (pcmFrame: Int16Array) => void;
  stop: () => Promise<void>;
}

export interface StreamingSttProvider {
  start: (
    config: StreamingSttConfig,
    callbacks: {
      onInterim: (result: SttInterimResult) => void;
      onFinal: (result: SttFinalResult) => void;
      onError: (error: SttError) => void;
      onClose: () => void;
    }
  ) => Promise<StreamingSttSession>;
}
