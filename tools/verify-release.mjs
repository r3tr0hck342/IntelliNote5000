import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const errors = [];
const warnings = [];
const releaseBuild = process.env.RELEASE_BUILD === '1';

const requireFile = (relativePath) => {
  const fullPath = path.join(repoRoot, relativePath);
  if (!fs.existsSync(fullPath)) {
    errors.push(`Missing required file: ${relativePath}`);
    return null;
  }
  return fullPath;
};

const requireFileWithGuidance = (relativePath, guidance) => {
  const fullPath = path.join(repoRoot, relativePath);
  if (!fs.existsSync(fullPath)) {
    const message = `Missing required file: ${relativePath}. ${guidance}`;
    if (releaseBuild) {
      errors.push(message);
    } else {
      warnings.push(message);
    }
    return null;
  }
  return fullPath;
};

const readFile = (relativePath) => {
  const fullPath = requireFile(relativePath);
  if (!fullPath) return null;
  return fs.readFileSync(fullPath, 'utf-8');
};

const requireIncludes = (content, needle, label) => {
  if (!content || !content.includes(needle)) {
    errors.push(`Missing ${label} (${needle}).`);
  }
};

const tauriConfPath = requireFile('src-tauri/tauri.conf.json');
if (tauriConfPath) {
  const tauriRaw = fs.readFileSync(tauriConfPath, 'utf-8');
  const tauriConf = JSON.parse(tauriRaw);
  const macosConfig = tauriConf?.tauri?.bundle?.macOS;
  if (!macosConfig) {
    errors.push('Missing tauri.bundle.macOS in src-tauri/tauri.conf.json.');
  } else {
    if (!macosConfig.infoPlist?.NSMicrophoneUsageDescription) {
      errors.push('Missing NSMicrophoneUsageDescription in tauri.bundle.macOS.infoPlist.');
    }
    if (!macosConfig.entitlements) {
      errors.push('Missing tauri.bundle.macOS.entitlements path.');
    } else {
      const entitlementsPath = path.join('src-tauri', macosConfig.entitlements);
      const entitlements = readFile(entitlementsPath);
      if (entitlements && !entitlements.includes('com.apple.security.device.audio-input')) {
        errors.push('Tauri entitlements missing com.apple.security.device.audio-input.');
      }
    }
    if (!macosConfig.signingIdentity) {
      errors.push('Missing tauri.bundle.macOS.signingIdentity.');
    }
    if (!macosConfig.providerShortName) {
      errors.push('Missing tauri.bundle.macOS.providerShortName.');
    }
    if (releaseBuild) {
      if (!process.env.TAURI_MACOS_SIGNING_IDENTITY) {
        errors.push('Missing TAURI_MACOS_SIGNING_IDENTITY for signed macOS release build.');
      }
      if (!process.env.TAURI_MACOS_PROVIDER_SHORT_NAME) {
        errors.push('Missing TAURI_MACOS_PROVIDER_SHORT_NAME for signed macOS release build.');
      }
    }
  }
}

const capacitorConfig = readFile('capacitor.config.ts');
if (capacitorConfig) {
  requireIncludes(capacitorConfig, 'NSMicrophoneUsageDescription', 'Capacitor iOS microphone usage description');
  requireIncludes(capacitorConfig, 'UIBackgroundModes', 'Capacitor iOS background audio modes');
  requireIncludes(capacitorConfig, 'RECORD_AUDIO', 'Capacitor Android RECORD_AUDIO permission');
  requireIncludes(capacitorConfig, 'FOREGROUND_SERVICE', 'Capacitor Android FOREGROUND_SERVICE permission');
  requireIncludes(capacitorConfig, 'FOREGROUND_SERVICE_MICROPHONE', 'Capacitor Android FOREGROUND_SERVICE_MICROPHONE permission');
}

const iosInfoPlist = readFile('ios/App/App/Info.plist');
if (iosInfoPlist) {
  requireIncludes(iosInfoPlist, 'NSMicrophoneUsageDescription', 'iOS Info.plist microphone usage description');
  requireIncludes(iosInfoPlist, 'UIBackgroundModes', 'iOS Info.plist background modes');
  requireIncludes(iosInfoPlist, '<string>audio</string>', 'iOS Info.plist audio background mode');
}

const androidManifest = readFile('android/app/src/main/AndroidManifest.xml');
if (androidManifest) {
  requireIncludes(androidManifest, 'android.permission.RECORD_AUDIO', 'Android manifest RECORD_AUDIO permission');
  requireIncludes(androidManifest, 'android.permission.FOREGROUND_SERVICE', 'Android manifest FOREGROUND_SERVICE permission');
  requireIncludes(androidManifest, 'android.permission.FOREGROUND_SERVICE_MICROPHONE', 'Android manifest FOREGROUND_SERVICE_MICROPHONE permission');
}

const iosProjectPath = 'ios/App/App.xcodeproj/project.pbxproj';
requireFileWithGuidance(iosProjectPath, 'Run: npm run native:ios:gen');
requireFileWithGuidance('ios/App/Podfile', 'Run: npm run native:ios:gen');
requireFileWithGuidance('android/app/build.gradle', 'Run: npm run native:android:gen');
requireFileWithGuidance('android/build.gradle', 'Run: npm run native:android:gen');

const envExample = readFile('.env.example');
if (envExample) {
  requireIncludes(envExample, 'VITE_AI_PROVIDER', '.env.example AI provider');
  requireIncludes(envExample, 'VITE_API_KEY', '.env.example AI API key');
  requireIncludes(envExample, 'VITE_AI_BASE_URL', '.env.example AI base URL');
  requireIncludes(envExample, 'VITE_STT_PROVIDER', '.env.example STT provider');
  requireIncludes(envExample, 'VITE_STT_API_KEY', '.env.example STT API key');
  requireIncludes(envExample, 'VITE_STT_LANGUAGE', '.env.example STT language');
  requireIncludes(envExample, 'VITE_STT_MODEL', '.env.example STT model');
  requireIncludes(envExample, 'TAURI_MACOS_SIGNING_IDENTITY', '.env.example macOS signing identity');
  requireIncludes(envExample, 'TAURI_MACOS_PROVIDER_SHORT_NAME', '.env.example macOS provider short name');
  requireIncludes(envExample, 'APPLE_ID', '.env.example notarization Apple ID');
  requireIncludes(envExample, 'APPLE_PASSWORD', '.env.example notarization app-specific password');
  requireIncludes(envExample, 'APPLE_TEAM_ID', '.env.example notarization team ID');
}

const envConfig = readFile('utils/env.ts');
if (envConfig) {
  requireIncludes(envConfig, 'VITE_AI_PROVIDER', 'env config AI provider wiring');
  requireIncludes(envConfig, 'VITE_API_KEY', 'env config AI API key wiring');
  requireIncludes(envConfig, 'VITE_AI_BASE_URL', 'env config AI base URL wiring');
}

const sttConfig = readFile('utils/transcriptionConfig.ts');
if (sttConfig) {
  requireIncludes(sttConfig, 'VITE_STT_PROVIDER', 'STT config provider wiring');
  requireIncludes(sttConfig, 'VITE_STT_API_KEY', 'STT config API key wiring');
  requireIncludes(sttConfig, 'VITE_STT_LANGUAGE', 'STT config language wiring');
  requireIncludes(sttConfig, 'VITE_STT_MODEL', 'STT config model wiring');
}

const packageJsonPath = requireFile('package.json');
if (packageJsonPath) {
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
  const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };
  if (!dependencies['@tauri-apps/cli']) {
    errors.push('Missing @tauri-apps/cli dependency.');
  }
  if (!dependencies['@capacitor/cli']) {
    errors.push('Missing @capacitor/cli dependency.');
  }
  if (!dependencies['capacitor-secure-storage-plugin']) {
    errors.push('Missing capacitor-secure-storage-plugin dependency.');
  }
}

if (warnings.length > 0) {
  console.warn('Release verification warnings:');
  warnings.forEach((warning) => console.warn(`- ${warning}`));
}

if (errors.length > 0) {
  console.error('Release verification failed:');
  errors.forEach((error) => console.error(`- ${error}`));
  process.exit(1);
} else {
  console.log('Release verification passed.');
}
