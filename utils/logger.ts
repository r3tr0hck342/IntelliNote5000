export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  id: string;
  timestamp: string;
  level: LogLevel;
  message: string;
  data?: Record<string, unknown>;
}

const MAX_LOGS = 200;
const logs: LogEntry[] = [];
const listeners = new Set<(items: LogEntry[]) => void>();

const SENSITIVE_KEYS = ['apikey', 'api_key', 'token', 'authorization', 'password', 'secret'];

const isSensitiveKey = (key: string) => SENSITIVE_KEYS.some(item => key.toLowerCase().includes(item));

const redactValue = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(redactValue);
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).map(([key, val]) => [
      key,
      isSensitiveKey(key) ? '[REDACTED]' : redactValue(val),
    ]);
    return Object.fromEntries(entries);
  }
  return value;
};

const notify = () => {
  const snapshot = [...logs];
  listeners.forEach(listener => listener(snapshot));
};

export const logEvent = (level: LogLevel, message: string, data?: Record<string, unknown>) => {
  const entry: LogEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    level,
    message,
    data: data ? (redactValue(data) as Record<string, unknown>) : undefined,
  };
  logs.push(entry);
  if (logs.length > MAX_LOGS) {
    logs.splice(0, logs.length - MAX_LOGS);
  }
  notify();
};

export const subscribeToLogs = (listener: (items: LogEntry[]) => void) => {
  listeners.add(listener);
  listener([...logs]);
  return () => listeners.delete(listener);
};

export const getLogs = () => [...logs];

export const clearLogs = () => {
  logs.splice(0, logs.length);
  notify();
};
