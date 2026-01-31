import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import os from 'os';
import { getBuildInfo } from './build-info.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const outputDir = path.join(repoRoot, 'dist', 'testers');
const testersBaseName = 'IntelliNote5000-mac-unsigned';

const runCommand = (command, args, options = {}) => {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.status !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(' ')}`);
  }
};

const commandExists = (command) => {
  const result = spawnSync('which', [command], { stdio: 'ignore' });
  return result.status === 0;
};

const ensureEmptyDir = (dirPath) => {
  if (fs.existsSync(dirPath)) {
    fs.rmSync(dirPath, { recursive: true, force: true });
  }
  fs.mkdirSync(dirPath, { recursive: true });
};

const findLatestAppBundle = (rootDir) => {
  const candidates = [];
  const stack = [rootDir];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch (error) {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory() && entry.name.endsWith('.app')) {
        try {
          const stats = fs.statSync(fullPath);
          candidates.push({ path: fullPath, mtimeMs: stats.mtimeMs });
        } catch (error) {
          // Skip unreadable bundles
        }
      } else if (entry.isDirectory()) {
        stack.push(fullPath);
      }
    }
  }

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return candidates[0].path;
};

const computeSha256 = (filePath) => {
  const hash = crypto.createHash('sha256');
  const data = fs.readFileSync(filePath);
  hash.update(data);
  return hash.digest('hex');
};

const writeTesterReadme = (readmePath, buildLabel) => {
  const content = `IntelliNote5000 macOS Test Build (Unsigned)\n` +
    `Build label: ${buildLabel}\n\n` +
    `This build is unsigned and NOT notarized. It is intended for limited testing only.\n\n` +
    `How to open the app (Gatekeeper):\n` +
    `1) Right-click IntelliNote5000.app and choose Open.\n` +
    `2) Click Open in the prompt.\n` +
    `If macOS blocks the app, go to System Settings > Privacy & Security,\n` +
    `scroll to the Security section, and click Open Anyway.\n\n` +
    `Microphone permission behavior:\n` +
    `- The first time you start live transcription, macOS will ask for microphone access.\n` +
    `- Choose Allow. If you accidentally deny, enable it in System Settings > Privacy & Security > Microphone.\n\n` +
    `Mic/STT probe (in-app):\n` +
    `1) Open Settings (gear icon in the sidebar).\n` +
    `2) Configure a streaming STT provider and save.\n` +
    `3) Start a Live Note session and click the big microphone button to start streaming transcription.\n` +
    `   You should see live text updates and status changes.\n\n` +
    `Diagnostics logs (how to export):\n` +
    `1) Open Settings and enable the Diagnostics panel toggle.\n` +
    `2) The Diagnostics panel appears at the bottom-right of the app.\n` +
    `3) Select the log entries, copy them, and paste into your report.\n` +
    `   (Screenshots are also acceptable if copy/paste is blocked.)\n\n` +
    `Please send the copied diagnostics, a brief description of your test, and any errors\n` +
    `to the release coordinator.\n`;

  fs.writeFileSync(readmePath, content, 'utf-8');
};

const createZip = (appPath, zipPath) => {
  if (commandExists('ditto')) {
    runCommand('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', appPath, zipPath]);
    return;
  }

  if (commandExists('zip')) {
    const parentDir = path.dirname(appPath);
    const appName = path.basename(appPath);
    runCommand('zip', ['-r', zipPath, appName], { cwd: parentDir });
    return;
  }

  throw new Error('No zip tool available. Install macOS command line tools or add zip to PATH.');
};

const createDmg = (appPath, dmgPath) => {
  if (os.platform() !== 'darwin') {
    return { created: false, reason: 'DMG packaging requires macOS (hdiutil).' };
  }
  if (!commandExists('hdiutil')) {
    return { created: false, reason: 'hdiutil is unavailable; cannot create DMG.' };
  }

  const stagingDir = path.join(outputDir, 'dmg-staging');
  ensureEmptyDir(stagingDir);

  const stagedAppName = 'IntelliNote5000.app';
  const stagedAppPath = path.join(stagingDir, stagedAppName);
  fs.cpSync(appPath, stagedAppPath, { recursive: true });

  try {
    const applicationsLink = path.join(stagingDir, 'Applications');
    if (!fs.existsSync(applicationsLink)) {
      fs.symlinkSync('/Applications', applicationsLink);
    }
  } catch (error) {
    // Continue without Applications symlink if not permitted.
  }

  try {
    runCommand('hdiutil', [
      'create',
      '-volname',
      'IntelliNote5000',
      '-srcfolder',
      stagingDir,
      '-ov',
      '-format',
      'UDZO',
      dmgPath,
    ]);
  } finally {
    fs.rmSync(stagingDir, { recursive: true, force: true });
  }

  return { created: true };
};

const main = () => {
  const bundleRoot = path.join(repoRoot, 'src-tauri', 'target', 'release', 'bundle');
  if (!fs.existsSync(bundleRoot)) {
    throw new Error(`Bundle output not found: ${bundleRoot}. Run the Tauri build first.`);
  }

  const appPath = findLatestAppBundle(bundleRoot);
  if (!appPath) {
    throw new Error('No .app bundle found under src-tauri/target/release/bundle.');
  }

  ensureEmptyDir(outputDir);

  const zipPath = path.join(outputDir, `${testersBaseName}.zip`);
  const dmgPath = path.join(outputDir, `${testersBaseName}.dmg`);
  const shaPath = path.join(outputDir, `${testersBaseName}.sha256`);
  const readmePath = path.join(outputDir, 'README-TESTERS.txt');
  const buildInfoPath = path.join(outputDir, 'BUILD.txt');

  const buildInfo = getBuildInfo();
  const buildLabel = buildInfo.label;

  writeTesterReadme(readmePath, buildLabel);
  fs.writeFileSync(buildInfoPath, `${buildLabel}\n`, 'utf-8');
  createZip(appPath, zipPath);

  const dmgResult = createDmg(appPath, dmgPath);

  const hashes = [];
  hashes.push({ file: zipPath, hash: computeSha256(zipPath) });
  if (dmgResult.created) {
    hashes.push({ file: dmgPath, hash: computeSha256(dmgPath) });
  }

  const shaContent = hashes
    .map(({ file, hash }) => `${hash}  ${path.basename(file)}`)
    .join('\n') + '\n';
  fs.writeFileSync(shaPath, shaContent, 'utf-8');

  const artifacts = [zipPath, shaPath, readmePath, buildInfoPath];
  if (dmgResult.created) {
    artifacts.push(dmgPath);
  }
  const missingArtifacts = artifacts.filter((artifact) => !fs.existsSync(artifact));
  if (missingArtifacts.length > 0) {
    throw new Error(`Missing artifacts:\n${missingArtifacts.map((artifact) => `- ${artifact}`).join('\n')}`);
  }

  console.log('macOS test packaging complete.');
  console.log(`App bundle: ${appPath}`);
  console.log(`Build label: ${buildLabel}`);
  console.log(`Version: ${buildInfo.version}`);
  console.log(`Git SHA: ${buildInfo.commit}`);
  console.log('Artifacts:');
  console.log(`- ${zipPath}`);
  if (dmgResult.created) {
    console.log(`- ${dmgPath}`);
  } else if (dmgResult.reason) {
    console.log(`- ${dmgPath} (skipped: ${dmgResult.reason})`);
  }
  console.log(`- ${shaPath}`);
  console.log(`- ${readmePath}`);
  console.log(`- ${buildInfoPath}`);
  console.log('Hashes:');
  hashes.forEach(({ file, hash }) => {
    console.log(`${path.basename(file)}: ${hash}`);
  });
};

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
