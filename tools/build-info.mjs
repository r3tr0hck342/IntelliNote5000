import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const getPackageVersion = (rootDir) => {
  const packageJsonPath = path.join(rootDir, 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
  return packageJson.version ?? 'unknown';
};

const getGitShortSha = () => {
  const result = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf-8' });
  if (result.status !== 0) {
    return null;
  }
  return result.stdout.trim() || null;
};

const formatBuildTimestamp = (timestamp) => {
  return timestamp.replace(/[-:]/g, '').replace(/\..*/, '');
};

export const getBuildInfo = (options = {}) => {
  const rootDir = options.repoRoot ?? repoRoot;
  const now = options.now ?? new Date();
  const time = now.toISOString();
  const version = getPackageVersion(rootDir);
  const commit = getGitShortSha();
  const envLabel = (process.env.BUILD_LABEL ?? '').trim();
  const buildStamp = commit ?? formatBuildTimestamp(time);
  const label = envLabel || `IntelliNote5000 ${version} (${buildStamp})`;

  return {
    label,
    version,
    commit: commit ?? 'unknown',
    time
  };
};

export const formatBuildInfoText = (buildInfo) => {
  return [
    `Build label: ${buildInfo.label}`,
    `Version: ${buildInfo.version}`,
    `Commit: ${buildInfo.commit}`,
    `Built at: ${buildInfo.time}`,
    ''
  ].join('\n');
};

const main = () => {
  const buildInfo = getBuildInfo();
  if (process.argv.includes('--json')) {
    console.log(`${JSON.stringify(buildInfo, null, 2)}\n`);
    return;
  }
  console.log(formatBuildInfoText(buildInfo));
};

if (import.meta.url === `file://${__filename}`) {
  main();
}
