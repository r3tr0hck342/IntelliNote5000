import { invoke } from '@tauri-apps/api/core';
import { isTauri } from './native.ts';

export const desktopWorkflow = async <T>(
  command: string,
  args: Record<string, unknown>,
  fallback: () => T,
): Promise<T> => {
  if (isTauri()) {
    try {
      return await invoke<T>(command, args);
    } catch {
      // Browser implementations also cover a desktop shell with an unavailable command.
    }
  }
  return fallback();
};
