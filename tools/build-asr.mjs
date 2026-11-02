// Builds the on-device ASR sidecar (src-tauri/asr) and places it where Tauri's `externalBin`
// expects it: src-tauri/binaries/intellinote-asr-<target-triple>[.exe].
// Usage: node tools/build-asr.mjs [--target <triple>]   (defaults to the host triple)
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = path.join(repoRoot, 'src-tauri', 'asr', 'Cargo.toml');

const run = (command, args) => {
  const result = spawnSync(command, args, { stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf-8' });
  if (result.status !== 0) {
    console.error(`Command failed: ${command} ${args.join(' ')}`);
    process.exit(result.status ?? 1);
  }
  return result.stdout;
};

// Tauri sets TAURI_ENV_TARGET_TRIPLE for beforeBuildCommand/beforeDevCommand (see the
// `beforeBuildCommand` docs in @tauri-apps/cli config.schema.json).
const targetFlag = process.argv.indexOf('--target');
const hostTarget = () => run('rustc', ['-vV']).split('\n').find(line => line.startsWith('host: '))?.slice('host: '.length).trim();
const requested = targetFlag > -1 ? process.argv[targetFlag + 1] : process.env.TAURI_ENV_TARGET_TRIPLE;
const target = requested || hostTarget();
if (!target) {
  console.error('Could not determine the Rust target triple.');
  process.exit(1);
}

// Builds one triple and returns the path of the produced binary.
const buildFor = (triple) => {
  const explicit = Boolean(requested);
  const args = ['build', '--release', '--locked', '--manifest-path', manifest];
  if (explicit) args.push('--target', triple);
  const build = spawnSync('cargo', args, { stdio: 'inherit' });
  if (build.status !== 0) process.exit(build.status ?? 1);
  const exe = triple.includes('windows') ? '.exe' : '';
  return path.join(repoRoot, 'src-tauri', 'asr', 'target', ...(explicit ? [triple] : []), 'release', `intellinote-asr${exe}`);
};

const destDir = path.join(repoRoot, 'src-tauri', 'binaries');
mkdirSync(destDir, { recursive: true });
const exe = target.includes('windows') ? '.exe' : '';
const dest = path.join(destDir, `intellinote-asr-${target}${exe}`);

if (target === 'universal-apple-darwin') {
  // sherpa-onnx ships per-arch macOS libraries only, so build both and merge them.
  const arches = ['aarch64-apple-darwin', 'x86_64-apple-darwin'];
  const parts = arches.map(buildFor);
  run('lipo', ['-create', '-output', dest, ...parts]);
  // Tauri compiles the app once per arch, and each compile checks for its own per-arch sidecar.
  arches.forEach((arch, i) => copyFileSync(parts[i], path.join(destDir, `intellinote-asr-${arch}`)));
} else {
  copyFileSync(buildFor(target), dest);
}
console.log(`ASR sidecar ready: src-tauri/binaries/intellinote-asr-${target}${exe}`);
