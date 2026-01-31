import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const tauriConfigPath = path.join(repoRoot, 'src-tauri', 'tauri.conf.json');

const args = new Set(process.argv.slice(2));
const signedBuild = args.has('--signed');
const unsignedBuild = args.has('--unsigned');

if (!signedBuild && !unsignedBuild) {
  console.error('Usage: node tools/release-tauri.mjs --signed|--unsigned');
  process.exit(1);
}

const tauriRaw = fs.readFileSync(tauriConfigPath, 'utf-8');
const tauriConfig = JSON.parse(tauriRaw);
const macosConfig = tauriConfig?.tauri?.bundle?.macOS;

if (!macosConfig) {
  console.error('Missing tauri.bundle.macOS configuration.');
  process.exit(1);
}

const notarizeRequested =
  process.env.TAURI_NOTARIZE === '1' ||
  process.env.APPLE_ID ||
  process.env.APPLE_PASSWORD ||
  process.env.APPLE_TEAM_ID;

const requireEnv = (name) => {
  if (!process.env[name]) {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return process.env[name];
};

const writeConfig = () => {
  fs.writeFileSync(tauriConfigPath, `${JSON.stringify(tauriConfig, null, 2)}\n`, 'utf-8');
};

const restoreConfig = () => {
  fs.writeFileSync(tauriConfigPath, tauriRaw, 'utf-8');
};

const verifyEnv = { ...process.env };
if (signedBuild) {
  verifyEnv.RELEASE_BUILD = '1';
}

const verifyResult = spawnSync('node', ['tools/verify-release.mjs'], {
  cwd: repoRoot,
  stdio: 'inherit',
  env: verifyEnv
});

if (verifyResult.status !== 0) {
  process.exit(verifyResult.status ?? 1);
}

if (signedBuild) {
  macosConfig.signingIdentity = requireEnv('TAURI_MACOS_SIGNING_IDENTITY');
  macosConfig.providerShortName = requireEnv('TAURI_MACOS_PROVIDER_SHORT_NAME');

  if (notarizeRequested) {
    requireEnv('APPLE_ID');
    requireEnv('APPLE_PASSWORD');
    requireEnv('APPLE_TEAM_ID');
  }
} else {
  macosConfig.signingIdentity = null;
  macosConfig.providerShortName = null;
}

writeConfig();

const buildResult = spawnSync('npm', ['run', 'tauri', '--', 'build'], {
  cwd: repoRoot,
  stdio: 'inherit',
  env: process.env
});

restoreConfig();

if (buildResult.status !== 0) {
  process.exit(buildResult.status ?? 1);
}

const bundlePath = path.join('src-tauri', 'target', 'release', 'bundle');
console.log(`Tauri build complete. Artifacts are in ${bundlePath}.`);
