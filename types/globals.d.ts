import type { ApiConfig } from './ai';
import type { SttConfig } from './stt';

// Globals the app reads or sets on window, typed so callers don't need `as any`.
declare global {
  interface Window {
    __INTELLINOTE_API_CONFIG?: ApiConfig;
    __INTELLINOTE_STT_CONFIG?: SttConfig;
    __autoGenTimers?: Record<string, number>;
    __TAURI__?: unknown;
    Capacitor?: { isNativePlatform?: () => boolean };
    webkitAudioContext?: typeof AudioContext;
  }
}

export {};
