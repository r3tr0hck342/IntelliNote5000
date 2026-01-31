import { SttConfig, StreamingSttConfig } from '../../types/stt';
import { createStreamingSttProvider } from './index';
import { RingBuffer } from '../../utils/ringBuffer';
import { logEvent } from '../../utils/logger';
import {
  createSttProbeStats,
  finalizeSttProbeStats,
  recordSttProbeAudioDropped,
  recordSttProbeAudioSent,
  recordSttProbeClose,
  recordSttProbeFinal,
  recordSttProbeInterim,
  recordSttProbeQueueDepth,
  recordSttProbeReconnect,
  setLastSttProbeSummary,
  SttProbeSummary,
  SttProbeStats,
} from '../../utils/sttProbe';

const TARGET_SAMPLE_RATE = 16000;
const AUDIO_BUFFER_CAPACITY = 40;
const AUDIO_FLUSH_INTERVAL_MS = 50;
const AUDIO_FRAMES_PER_FLUSH = 4;

interface SttProbeOptions {
  durationMs?: number;
  onProgress?: (summary: SttProbeSummary) => void;
}

const formatCloseReason = (event?: CloseEvent) => {
  if (!event) return null;
  const base = `code ${event.code}`;
  if (event.reason) {
    return `${base} (${event.reason})`;
  }
  return base;
};

export const runSttProbe = async (
  config: SttConfig,
  options?: SttProbeOptions
): Promise<SttProbeSummary> => {
  const durationMs = options?.durationMs ?? 10000;
  const startedAtMs = Date.now();
  let stats: SttProbeStats = createSttProbeStats(startedAtMs);
  const provider = createStreamingSttProvider(config);
  const streamConfig: StreamingSttConfig = {
    sampleRate: TARGET_SAMPLE_RATE,
    language: config.language,
    model: config.model,
    enableInterimResults: true,
  };

  let isStopping = false;
  let reconnecting = false;
  let stopTimer: number | null = null;
  let audioContext: AudioContext | null = null;
  let scriptProcessor: ScriptProcessorNode | null = null;
  let mediaStream: MediaStream | null = null;
  let audioFlushTimer: number | null = null;
  const audioBuffer = new RingBuffer<Int16Array>(AUDIO_BUFFER_CAPACITY);

  const updateStats = (next: SttProbeStats) => {
    stats = next;
    options?.onProgress?.(finalizeSttProbeStats(stats, Date.now()));
  };

  const stopProbe = async () => {
    if (isStopping) return;
    isStopping = true;
    if (stopTimer) {
      window.clearTimeout(stopTimer);
    }
    if (audioFlushTimer) {
      window.clearInterval(audioFlushTimer);
    }
    scriptProcessor?.disconnect();
    scriptProcessor = null;
    if (audioContext && audioContext.state !== 'closed') {
      await audioContext.close();
    }
    audioContext = null;
    if (mediaStream) {
      mediaStream.getTracks().forEach(track => track.stop());
    }
    mediaStream = null;
    await session.stop();
    const summary = finalizeSttProbeStats(stats, Date.now());
    setLastSttProbeSummary(summary);
    return summary;
  };

  const session = provider.createSession(streamConfig, {
    onInterim: () => {
      updateStats(recordSttProbeInterim(stats, Date.now()));
    },
    onFinal: () => {
      updateStats(recordSttProbeFinal(stats, Date.now()));
    },
    onError: (error) => {
      logEvent('warn', 'STT probe error', { code: error.code, retryable: error.retryable });
    },
    onStateChange: (state) => {
      if (state === 'connected') {
        reconnecting = false;
      }
      if (state === 'closed' && !isStopping && !reconnecting) {
        reconnecting = true;
        updateStats(recordSttProbeReconnect(stats));
        session.connect().catch(() => {
          reconnecting = false;
        });
      }
    },
    onSocketClose: (event) => {
      updateStats(recordSttProbeClose(stats, formatCloseReason(event) ?? undefined));
    },
  });

  try {
    await session.connect();
    if (!navigator?.mediaDevices?.getUserMedia) {
      throw new Error('Microphone access is not available in this environment.');
    }
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: TARGET_SAMPLE_RATE });
    if (audioContext.sampleRate !== TARGET_SAMPLE_RATE) {
      logEvent('warn', 'STT probe sample rate mismatch', {
        actual: audioContext.sampleRate,
        expected: TARGET_SAMPLE_RATE,
      });
    }

    const source = audioContext.createMediaStreamSource(mediaStream);
    scriptProcessor = audioContext.createScriptProcessor(4096, 1, 1);
    scriptProcessor.onaudioprocess = (audioProcessingEvent) => {
      const inputData = audioProcessingEvent.inputBuffer.getChannelData(0);
      const int16 = new Int16Array(inputData.length);
      for (let i = 0; i < inputData.length; i += 1) {
        int16[i] = inputData[i] < 0 ? inputData[i] * 32768 : inputData[i] * 32767;
      }
      if (audioBuffer.length >= AUDIO_BUFFER_CAPACITY) {
        updateStats(recordSttProbeAudioDropped(stats));
        return;
      }
      audioBuffer.push(int16);
    };

    audioFlushTimer = window.setInterval(() => {
      const depthSample = audioBuffer.length;
      updateStats(recordSttProbeQueueDepth(stats, depthSample));
      let sent = 0;
      while (sent < AUDIO_FRAMES_PER_FLUSH) {
        const frame = audioBuffer.shift();
        if (!frame) break;
        session.sendAudioFrame(frame);
        sent += 1;
      }
      if (sent > 0) {
        updateStats(recordSttProbeAudioSent(stats, sent));
      }
    }, AUDIO_FLUSH_INTERVAL_MS);

    source.connect(scriptProcessor);
    scriptProcessor.connect(audioContext.destination);

    return new Promise((resolve, reject) => {
      stopTimer = window.setTimeout(async () => {
        try {
          const summary = await stopProbe();
          resolve(summary ?? finalizeSttProbeStats(stats, Date.now()));
        } catch (error) {
          reject(error);
        }
      }, durationMs);
    });
  } catch (error) {
    await stopProbe();
    throw error;
  }
};
