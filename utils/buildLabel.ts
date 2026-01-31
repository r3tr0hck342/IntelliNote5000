import packageJson from '../package.json';

const formatBuildTimestamp = (timestamp: string): string => {
  return timestamp.replace(/[-:]/g, '').replace(/\..*/, '');
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

export const getBuildLabel = (): string => {
  const envLabel = (getEnvValue('VITE_BUILD_LABEL') ?? '').trim();
  if (envLabel) {
    return envLabel;
  }

  const version = packageJson.version ?? 'unknown';
  const buildTime = getEnvValue('VITE_BUILD_TIME') ?? new Date().toISOString();
  const stamp = formatBuildTimestamp(buildTime);
  return `IntelliNote5000 ${version} (${stamp})`;
};
