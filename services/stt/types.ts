import { StreamingSttConfig, SttInterimResult, SttFinalResult } from '../../types/stt';

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
      onError: (error: Error) => void;
      onClose: () => void;
    }
  ) => Promise<StreamingSttSession>;
}
