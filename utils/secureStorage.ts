import type { ApiConfig } from '../types/ai';
import { isTauri } from './native';

const STORAGE_KEY = 'intellinote-api-config';
const CAP_STORAGE_KEY = 'intellinote_api_config';

const isCapacitorNative = () => {
  if (typeof window === 'undefined') return false;
  const maybeCapacitor = (window as any).Capacitor;
  return !!maybeCapacitor && typeof maybeCapacitor.isNativePlatform === 'function' && maybeCapacitor.isNativePlatform();
};

const fallbackStore = {
  load: (): ApiConfig | null => {
    if (typeof window === 'undefined' || typeof localStorage === 'undefined') return null;
    const value = localStorage.getItem(STORAGE_KEY);
    if (!value) return null;
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  },
  save: (config: ApiConfig) => {
    if (typeof window === 'undefined' || typeof localStorage === 'undefined') return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  },
  clear: () => {
    if (typeof window === 'undefined' || typeof localStorage === 'undefined') return;
    localStorage.removeItem(STORAGE_KEY);
  }
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

export const secureStorage = {
  async get(): Promise<ApiConfig | null> {
    if (isTauri()) {
      try {
        const result = await (await import('@tauri-apps/api/tauri')).invoke<ApiConfig | null>('secure_load_api_config');
        return result ?? null;
      } catch (error) {
        console.warn('Failed to load config from Tauri keychain:', error);
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

  async set(config: ApiConfig): Promise<void> {
    if (isTauri()) {
      try {
        await (await import('@tauri-apps/api/tauri')).invoke('secure_save_api_config', { config });
        return;
      } catch (error) {
        console.warn('Failed to persist config via Tauri keychain:', error);
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
        await (await import('@tauri-apps/api/tauri')).invoke('secure_clear_api_config');
        return;
      } catch (error) {
        console.warn('Failed to clear Tauri keychain entry:', error);
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
  }
};
