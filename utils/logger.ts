import { redactSensitiveData } from './redaction';

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
    data: data ? (redactSensitiveData(data) as Record<string, unknown>) : undefined,
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
