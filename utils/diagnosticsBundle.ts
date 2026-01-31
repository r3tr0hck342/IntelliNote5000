import packageJson from '../package.json';
import { getLogs, LogEntry } from './logger';
import { redactSensitiveData, redactSensitiveText } from './redaction';
import { isTauri } from './native';
import type { SttProbeSummary } from './sttProbe';
import { getLastSttProbeSummary } from './sttProbe';
import { getBuildLabel } from './buildLabel';

export interface AppInfo {
  name: string;
  version: string;
  buildMode: string;
  buildTime: string | null;
  buildLabel: string;
}

export interface PlatformInfo {
  target: 'web' | 'tauri' | 'capacitor';
  userAgent?: string;
}

export interface ProviderConfigPresence {
  aiConfigured: boolean;
  sttConfigured: boolean;
}

export interface DiagnosticsBundle {
  app: AppInfo;
  platform: PlatformInfo;
  generatedAt: string;
  providerConfigPresence: ProviderConfigPresence;
  sttProbeLastResult: SttProbeSummary | null;
  logs: LogEntry[];
}

interface DiagnosticsBundleOptions {
  appInfo?: AppInfo;
  platform?: PlatformInfo;
  logs?: LogEntry[];
  sttProbeSummary?: SttProbeSummary | null;
  providerConfigPresence?: ProviderConfigPresence;
}

const getBuildMode = (): string => {
  if (typeof import.meta !== 'undefined' && (import.meta as any).env?.MODE) {
    return (import.meta as any).env.MODE;
  }
  if (typeof process !== 'undefined' && process.env?.NODE_ENV) {
    return process.env.NODE_ENV;
  }
  return 'unknown';
};

export const getAppInfo = (): AppInfo => {
  const buildTime = typeof import.meta !== 'undefined' ? (import.meta as any).env?.VITE_BUILD_TIME : undefined;
  return {
    name: packageJson.name,
    version: packageJson.version,
    buildMode: getBuildMode(),
    buildTime: buildTime ?? null,
    buildLabel: getBuildLabel(),
  };
};

export const getPlatformInfo = (): PlatformInfo => {
  if (isTauri()) {
    return { target: 'tauri', userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined };
  }
  const isCapacitor = typeof window !== 'undefined'
    && !!(window as any).Capacitor
    && typeof (window as any).Capacitor.isNativePlatform === 'function'
    && (window as any).Capacitor.isNativePlatform();
  if (isCapacitor) {
    return { target: 'capacitor', userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined };
  }
  return { target: 'web', userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined };
};

const redactLogEntry = (entry: LogEntry): LogEntry => ({
  ...entry,
  message: redactSensitiveText(entry.message),
  data: entry.data ? (redactSensitiveData(entry.data) as Record<string, unknown>) : undefined,
});

export const buildDiagnosticsBundle = (options: DiagnosticsBundleOptions = {}): DiagnosticsBundle => {
  const logs = (options.logs ?? getLogs()).map(redactLogEntry);
  return {
    app: options.appInfo ?? getAppInfo(),
    platform: options.platform ?? getPlatformInfo(),
    generatedAt: new Date().toISOString(),
    providerConfigPresence: options.providerConfigPresence ?? { aiConfigured: false, sttConfigured: false },
    sttProbeLastResult: options.sttProbeSummary ?? getLastSttProbeSummary(),
    logs,
  };
};

const triggerBrowserDownload = (payload: string, filename: string) => {
  const blob = new Blob([payload], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

export const exportDiagnosticsBundle = (options: DiagnosticsBundleOptions = {}) => {
  const bundle = buildDiagnosticsBundle(options);
  const payload = JSON.stringify(bundle, null, 2);
  const filename = `intellinote-diagnostics-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;

  if (typeof document === 'undefined') return;
  triggerBrowserDownload(payload, filename);
};
