import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const errors: string[] = [];

const requireFile = (relativePath: string) => {
  const fullPath = path.join(repoRoot, relativePath);
  if (!fs.existsSync(fullPath)) {
    errors.push(`Missing required file: ${relativePath}`);
    return null;
  }
  return fullPath;
};

const requireString = (value: unknown, label: string) => {
  if (!value || typeof value !== 'string' || value.trim().length === 0) {
    errors.push(`Missing ${label}.`);
  }
};

const tauriConfPath = requireFile('src-tauri/tauri.conf.json');
if (tauriConfPath) {
  const raw = fs.readFileSync(tauriConfPath, 'utf-8');
  const tauriConf = JSON.parse(raw);
  const macOSBundle = tauriConf?.tauri?.bundle?.macOS;
  const entitlementsPath = macOSBundle?.entitlements;
  requireString(entitlementsPath, 'macOS entitlements path in tauri.conf.json');
  const infoPlist = macOSBundle?.infoPlist;
  requireString(infoPlist?.NSMicrophoneUsageDescription, 'macOS NSMicrophoneUsageDescription in tauri.conf.json');

  if (entitlementsPath) {
    const entitlementsFullPath = requireFile(path.join('src-tauri', entitlementsPath));
    if (entitlementsFullPath) {
      const entitlementsContent = fs.readFileSync(entitlementsFullPath, 'utf-8');
      if (!entitlementsContent.includes('com.apple.security.device.audio-input')) {
        errors.push('macOS entitlements missing com.apple.security.device.audio-input.');
      }
    }
  }
}

const capacitorConfigPath = requireFile('capacitor.config.ts');
if (capacitorConfigPath) {
  const capConfig = fs.readFileSync(capacitorConfigPath, 'utf-8');
  if (!capConfig.includes('NSMicrophoneUsageDescription')) {
    errors.push('Capacitor iOS config missing NSMicrophoneUsageDescription.');
  }
  if (!capConfig.includes('UIBackgroundModes')) {
    errors.push('Capacitor iOS config missing UIBackgroundModes audio setting.');
  }
  if (!capConfig.includes('RECORD_AUDIO')) {
    errors.push('Capacitor Android config missing RECORD_AUDIO permission.');
  }
  if (!capConfig.includes('FOREGROUND_SERVICE')) {
    errors.push('Capacitor Android config missing FOREGROUND_SERVICE permission.');
  }
}

if (errors.length > 0) {
  console.error('Platform verification failed:');
  errors.forEach(error => console.error(`- ${error}`));
  process.exit(1);
} else {
  console.log('Platform verification passed.');
}
