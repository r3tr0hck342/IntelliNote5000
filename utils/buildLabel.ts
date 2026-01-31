import packageJson from '../package.json';

export interface BuildInfo {
  appName: string;
  version: string;
  commit: string | null;
  buildTime: string;
  label: string;
}

const APP_NAME = 'IntelliNote5000';

const formatBuildTimestamp = (timestamp: string): string => {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return timestamp;
  }
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}-${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}`;
};

const getEnvValue = (key: string): string | undefined => {
  if (typeof import.meta !== 'undefined' && (import.meta as any).env?.[key] !== undefined) {
    return (import.meta as any).env[key];
  }
  if (typeof process !== 'undefined' && process.env?.[key] !== undefined) {
    return process.env[key];
  }
  return undefined;
};

const getBuildMode = (): string => {
  if (typeof import.meta !== 'undefined' && (import.meta as any).env?.MODE) {
    return (import.meta as any).env.MODE;
  }
  if (typeof process !== 'undefined' && process.env?.NODE_ENV) {
    return process.env.NODE_ENV;
  }
  return 'unknown';
};

export const getBuildInfo = (): BuildInfo => {
  const version = (getEnvValue('VITE_BUILD_VERSION') ?? packageJson.version ?? 'unknown').trim();
  const commit = (getEnvValue('VITE_BUILD_COMMIT') ?? '').trim() || null;
  const buildTime = (getEnvValue('VITE_BUILD_TIME') ?? new Date().toISOString()).trim();
  const envLabel = (getEnvValue('VITE_BUILD_LABEL') ?? '').trim();
  const mode = getBuildMode();
  const isDev = mode === 'development' || mode === 'dev';
  const stamp = commit ?? formatBuildTimestamp(buildTime);
  const label = envLabel || (isDev
    ? `${APP_NAME} dev (${stamp})`
    : `${APP_NAME} ${version} (${stamp})`);

  return {
    appName: APP_NAME,
    version,
    commit,
    buildTime,
    label,
  };
};

export const getBuildLabel = (): string => getBuildInfo().label;
