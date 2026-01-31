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

const requireFileExists = (relativePath: string, label: string) => {
  const fullPath = path.join(repoRoot, relativePath);
  if (!fs.existsSync(fullPath)) {
    errors.push(`Missing ${label}: ${relativePath}`);
  }
};

requireFileExists('src-tauri/tauri.conf.json', 'Tauri config');

const tauriConfPath = requireFile('src-tauri/tauri.conf.json');
if (tauriConfPath) {
  const raw = fs.readFileSync(tauriConfPath, 'utf-8');
  const tauriConf = JSON.parse(raw);
  const macOSBundle = tauriConf?.tauri?.bundle?.macOS;
  const bundleIcons = tauriConf?.tauri?.bundle?.icon;
  const entitlementsPath = macOSBundle?.entitlements;
  requireString(entitlementsPath, 'macOS entitlements path in tauri.conf.json');
  const infoPlist = macOSBundle?.infoPlist;
  requireString(infoPlist?.NSMicrophoneUsageDescription, 'macOS NSMicrophoneUsageDescription in tauri.conf.json');
  if (macOSBundle?.hardenedRuntime !== true) {
    errors.push('macOS hardened runtime must be enabled in tauri.conf.json.');
  }

  if (Array.isArray(bundleIcons)) {
    bundleIcons.forEach((iconPath: string) => {
      requireFileExists(path.join('src-tauri', iconPath), 'Tauri bundle icon');
    });
  } else if (typeof bundleIcons === 'string') {
    requireFileExists(path.join('src-tauri', bundleIcons), 'Tauri bundle icon');
  } else {
    errors.push('Missing tauri.bundle.icon entries in tauri.conf.json.');
  }

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
  if (!capConfig.includes('FOREGROUND_SERVICE_MICROPHONE')) {
    errors.push('Capacitor Android config missing FOREGROUND_SERVICE_MICROPHONE permission.');
  }
}

const packageJsonPath = requireFile('package.json');
if (packageJsonPath) {
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
  const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };
  if (!dependencies['capacitor-secure-storage-plugin']) {
    errors.push('Missing capacitor-secure-storage-plugin dependency for secure storage.');
  }
  if (!packageJson.scripts?.['package:mac:test']) {
    errors.push('Missing package:mac:test script in package.json.');
  }
}

const iosInfoPlistPath = path.join(repoRoot, 'ios', 'App', 'App', 'Info.plist');
if (fs.existsSync(iosInfoPlistPath)) {
  const infoPlist = fs.readFileSync(iosInfoPlistPath, 'utf-8');
  if (!infoPlist.includes('NSMicrophoneUsageDescription')) {
    errors.push('iOS Info.plist missing NSMicrophoneUsageDescription.');
  }
  if (!infoPlist.includes('UIBackgroundModes')) {
    errors.push('iOS Info.plist missing UIBackgroundModes (audio) entry.');
  }
  if (!infoPlist.includes('<string>audio</string>')) {
    errors.push('iOS Info.plist missing audio entry in UIBackgroundModes.');
  }
}

const androidManifestPath = path.join(repoRoot, 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
if (fs.existsSync(androidManifestPath)) {
  const manifest = fs.readFileSync(androidManifestPath, 'utf-8');
  if (!manifest.includes('android.permission.RECORD_AUDIO')) {
    errors.push('AndroidManifest.xml missing RECORD_AUDIO permission.');
  }
  if (!manifest.includes('android.permission.FOREGROUND_SERVICE')) {
    errors.push('AndroidManifest.xml missing FOREGROUND_SERVICE permission.');
  }
  if (!manifest.includes('android.permission.FOREGROUND_SERVICE_MICROPHONE')) {
    errors.push('AndroidManifest.xml missing FOREGROUND_SERVICE_MICROPHONE permission.');
  }
}

if (errors.length > 0) {
  console.error('Platform verification failed:');
  errors.forEach(error => console.error(`- ${error}`));
  process.exit(1);
} else {
  console.log('Platform verification passed.');
}
