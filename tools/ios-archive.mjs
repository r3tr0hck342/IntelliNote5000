import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const xcodeProj = path.join(repoRoot, 'ios', 'App', 'App.xcodeproj');
const podfile = path.join(repoRoot, 'ios', 'App', 'Podfile');

if (!fs.existsSync(xcodeProj) || !fs.existsSync(podfile)) {
  console.error('iOS native project is missing.');
  console.error('Run: npm run native:ios:gen');
  process.exit(1);
}

console.log('iOS archive guidance:');
console.log('- Open the project: npm run native:ios:open');
console.log('- In Xcode, select the Release scheme and a real device target.');
console.log('- Product > Archive, then distribute via Organizer.');
console.log('');
console.log('Optional CLI command (requires Xcode + signing configured):');
console.log(
  [
    'xcodebuild -workspace ios/App/App.xcworkspace',
    '-scheme App',
    '-configuration Release',
    '-archivePath build/App.xcarchive',
    'archive'
  ].join(' ')
);
