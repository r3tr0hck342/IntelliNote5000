export interface AutoGenerationConfig {
  debounceMs: number;
  minIntervalMs: number;
  finalSegmentBatchSize: number;
}

const STORAGE_KEY = 'intellinote-auto-generation-config';

const DEFAULT_CONFIG: AutoGenerationConfig = {
  debounceMs: 5000,
  minIntervalMs: 30000,
  finalSegmentBatchSize: 4,
};

export const loadAutoGenerationConfig = (): AutoGenerationConfig => {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return DEFAULT_CONFIG;
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return DEFAULT_CONFIG;
  try {
    const parsed = JSON.parse(raw) as Partial<AutoGenerationConfig>;
    return {
      debounceMs: Number(parsed.debounceMs ?? DEFAULT_CONFIG.debounceMs),
      minIntervalMs: Number(parsed.minIntervalMs ?? DEFAULT_CONFIG.minIntervalMs),
      finalSegmentBatchSize: Number(parsed.finalSegmentBatchSize ?? DEFAULT_CONFIG.finalSegmentBatchSize),
    };
  } catch {
    return DEFAULT_CONFIG;
  }
};

export const persistAutoGenerationConfig = (config: AutoGenerationConfig) => {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
};

export const clearAutoGenerationConfig = () => {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return;
  localStorage.removeItem(STORAGE_KEY);
};

export const getDefaultAutoGenerationConfig = () => DEFAULT_CONFIG;
