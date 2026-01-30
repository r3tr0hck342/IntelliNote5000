import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.intellinote.app',
  appName: 'IntelliNote',
  webDir: 'dist',
  server: {
    androidScheme: 'https'
  },
  ios: {
    contentInset: 'always',
    infoPlist: {
      NSMicrophoneUsageDescription: 'IntelliNote needs microphone access to capture lecture audio for live transcription.',
      UIBackgroundModes: ['audio']
    }
  },
  android: {
    permissions: [
      'RECORD_AUDIO',
      'FOREGROUND_SERVICE',
      'FOREGROUND_SERVICE_MICROPHONE'
    ]
  }
};

export default config;
