import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.intellinote.app',
  appName: 'IntelliNote',
  webDir: 'dist',
  server: {
    androidScheme: 'https'
  },
  // Microphone/background-audio permissions live in ios/App/App/Info.plist and
  // android/app/src/main/AndroidManifest.xml; Capacitor has no config keys for them.
  ios: {
    contentInset: 'always'
  }
};

export default config;
