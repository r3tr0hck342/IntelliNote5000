import type { SttConfig } from '../types/stt';
import { isTauri } from './native';

const STORAGE_KEY = 'intellinote-stt-config';
const CAP_STORAGE_KEY = 'intellinote_stt_config';

const isCapacitorNative = () => {
  if (typeof window === 'undefined') return false;
  const maybeCapacitor = (window as any).Capacitor;
  return !!maybeCapacitor && typeof maybeCapacitor.isNativePlatform === 'function' && maybeCapacitor.isNativePlatform();
};

const fallbackStore = {
  load: (): SttConfig | null => {
    if (typeof window === 'undefined' || typeof localStorage === 'undefined') return null;
    const value = localStorage.getItem(STORAGE_KEY);
    if (!value) return null;
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  },
  save: (config: SttConfig) => {
    if (typeof window === 'undefined' || typeof localStorage === 'undefined') return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  },
  clear: () => {
    if (typeof window === 'undefined' || typeof localStorage === 'undefined') return;
    localStorage.removeItem(STORAGE_KEY);
  },
};

const withCapacitorPlugin = async () => {
  if (!isCapacitorNative()) return null;
  try {
    const plugin = await import('capacitor-secure-storage-plugin');
    return plugin.SecureStoragePlugin;
  } catch (error) {
    console.warn('Capacitor secure storage plugin unavailable, falling back to localStorage.', error);
    return null;
  }
};

export const transcriptionStorage = {
  async get(): Promise<SttConfig | null> {
    if (isTauri()) {
      try {
        const result = await (await import('@tauri-apps/api/tauri')).invoke<SttConfig | null>('secure_load_stt_config');
        return result ?? null;
      } catch (error) {
        console.warn('Failed to load STT config from Tauri keychain:', error);
      }
    } else if (isCapacitorNative()) {
      const plugin = await withCapacitorPlugin();
      if (plugin) {
        try {
          const { value } = await plugin.get({ key: CAP_STORAGE_KEY });
          return value ? JSON.parse(value) : null;
        } catch (error) {
          if (error?.message?.includes('Item with the given key')) {
            return null;
          }
          console.warn('Capacitor secure storage read failed:', error);
        }
      }
    }
    return fallbackStore.load();
  },

  async set(config: SttConfig): Promise<void> {
    if (isTauri()) {
      try {
        await (await import('@tauri-apps/api/tauri')).invoke('secure_save_stt_config', { config });
        return;
      } catch (error) {
        console.warn('Failed to persist STT config via Tauri keychain:', error);
      }
    } else if (isCapacitorNative()) {
      const plugin = await withCapacitorPlugin();
      if (plugin) {
        try {
          await plugin.set({ key: CAP_STORAGE_KEY, value: JSON.stringify(config) });
          return;
        } catch (error) {
          console.warn('Capacitor secure storage save failed:', error);
        }
      }
    }
    fallbackStore.save(config);
  },

  async clear(): Promise<void> {
    if (isTauri()) {
      try {
        await (await import('@tauri-apps/api/tauri')).invoke('secure_clear_stt_config');
        return;
      } catch (error) {
        console.warn('Failed to clear Tauri keychain STT entry:', error);
      }
    } else if (isCapacitorNative()) {
      const plugin = await withCapacitorPlugin();
      if (plugin) {
        try {
          await plugin.remove({ key: CAP_STORAGE_KEY });
          return;
        } catch (error) {
          console.warn('Capacitor secure storage clear failed:', error);
        }
      }
    }
    fallbackStore.clear();
  },
};
