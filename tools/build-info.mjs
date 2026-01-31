import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const APP_NAME = 'IntelliNote5000';

const getPackageVersion = (rootDir) => {
  const packageJsonPath = path.join(rootDir, 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
  return packageJson.version ?? 'unknown';
};

const getGitShortSha = () => {
  const result = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf-8' });
  if (result.error || result.status !== 0) {
    return null;
  }
  const value = result.stdout.trim();
  return value || null;
};

const formatBuildTimestamp = (timestamp) => {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return timestamp;
  }
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}-${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}`;
};

const parseArgs = (argv) => {
  const args = new Set(argv);
  if (args.has('--dev')) return 'dev';
  if (args.has('--prod') || args.has('--production')) return 'prod';
  const modeArg = argv.find((item) => item.startsWith('--mode='));
  if (modeArg) {
    const [, mode] = modeArg.split('=');
    if (mode === 'dev') return 'dev';
    if (mode === 'prod' || mode === 'production') return 'prod';
  }
  return 'prod';
};

export const getBuildInfo = (options = {}) => {
  const rootDir = options.repoRoot ?? repoRoot;
  const mode = options.mode ?? 'prod';
  const now = options.now ?? new Date();
  const buildTime = now.toISOString();
  const version = getPackageVersion(rootDir);
  const commit = getGitShortSha();
  const stamp = commit ?? formatBuildTimestamp(buildTime);
  const label = mode === 'dev'
    ? `${APP_NAME} dev (${stamp})`
    : `${APP_NAME} ${version} (${stamp})`;

  return {
    appName: APP_NAME,
    version,
    commit,
    buildTime,
    label,
  };
};

export const formatBuildInfoText = (buildInfo) => {
  return [
    `Build label: ${buildInfo.label}`,
    `Version: ${buildInfo.version}`,
    `Commit: ${buildInfo.commit ?? 'unknown'}`,
    `Built at: ${buildInfo.buildTime}`,
    '',
  ].join('\n');
};

const main = () => {
  const mode = parseArgs(process.argv.slice(2));
  const buildInfo = getBuildInfo({ mode });
  if (process.argv.includes('--json')) {
    console.log(`${JSON.stringify(buildInfo, null, 2)}\n`);
    return;
  }
  console.log(buildInfo.label);
};

if (import.meta.url === `file://${__filename}`) {
  main();
}
