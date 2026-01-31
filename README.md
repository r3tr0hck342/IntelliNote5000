INTELLINOTE5000

## Run Locally (macOS + Node 20)

**Prerequisites**
- Node.js 20.x and npm 10.x (`nvm install 20 && nvm use 20`)
- macOS Sonoma or newer (for desktop and iOS builds)
- Xcode + CLT, Rust toolchain, `tauri-cli`, CocoaPods (see checklist below)

**Steps**
1. Install dependencies: `npm install`
2. (Optional dev fallback) Copy `.env.example` to `.env.local` and set `VITE_API_KEY`, `VITE_AI_PROVIDER`, and `VITE_AI_BASE_URL` if you want Vite to boot with pre-filled credentials:
   ```bash
   cp .env.example .env.local
   # Add your provider + key. Runtime Settings UI is still the recommended approach.
   ```
3. Start the Vite dev server (port 1420, strict): `npm run dev`
4. Launch `http://localhost:1420`, open **Settings → AI Provider**, choose Gemini or OpenAI, and paste your API key. Keys are stored in secure storage on native builds; browser storage is opt-in and controlled in Settings.
5. Open **Settings → Transcription Provider** to configure a streaming STT key (Deepgram). This powers real-time, word-by-word transcription with interim results.
6. Allow microphone access if you plan to use live transcription.
7. `npm install` is configured with `legacy-peer-deps=true` (see `.npmrc`) so the Capacitor secure storage plugin can coexist with Capacitor 6 until the upstream publishes updated peer constraints.

### AI Provider Support

| Provider | Features | Notes |
| --- | --- | --- |
| Google Gemini | ✅ Notes, study guide, questions, flashcards, tags, chat | Requires Gemini API key. |
| OpenAI (Chat Completions-compatible) | ✅ Notes, study guide, questions, flashcards, tags, chat, transcript editing | Uses GPT-4o-mini / GPT-4o by default. Provide a custom base URL if routing through a proxy such as Azure/OpenRouter. |

### Streaming Transcription (Word-by-Word)
- **Provider**: Deepgram streaming WebSocket API (interim + final results).
- Configure in **Settings → Transcription Provider** or via `.env.local` keys.
- **Audio format**: PCM 16-bit, mono, 16 kHz (captured via Web Audio and streamed as `linear16` frames).
- Live lecture sessions store interim and final transcript segments (with utterance IDs when available) plus timestamps, confidence, and speaker labels.
- The recorder always stores the full audio capture locally; if streaming drops, you can run **Transcribe After Recording** to process the saved audio via Deepgram’s prerecorded API.
- Reconnect behavior: exponential backoff (up to ~10s) with a capped number of retries; audio capture continues during reconnect attempts.

### Transcript Import (Production v1)
- Use **Upload → Import Transcript** to add `.txt` or `.md` transcripts to a new or existing session.
- The importer normalizes whitespace, preserves paragraphs, and detects timestamps (`[00:12:03]`, `00:12:03.123`, SRT/VTT cues).
- Imported transcripts run the same AI pipeline as live sessions (notes, study guide, test questions, flashcards, tags) and show progress + cancellation in the import modal.

### Diagnostics
- Open the Diagnostics panel from **Settings → Diagnostics**.
- **Run 10s STT Probe**: Requests microphone access, streams audio to the configured Deepgram provider for 10 seconds, and reports timing stats (time to first interim/final, cadence, reconnects, queue depth). No transcripts are saved; this is strictly a connectivity and latency check.
- **Dry-run Import Pipeline**: Runs the transcript import normalization + segmentation and triggers the AI pipeline entrypoints without calling external APIs. Use this when API keys are not configured to confirm that notes, study guide, test questions, flashcards, tags, and chat wiring are all connected.
- **Export Diagnostics Bundle**: Use **Settings → Diagnostics & Storage → Export Diagnostics Bundle** to download a JSON snapshot containing app/build info, platform info, redacted logs, last STT probe stats, and provider configuration presence flags. Share this file with the team when reporting issues.
- **Reset App State**: Use **Settings → Diagnostics & Storage → Reset App State** to clear local sessions and cached settings. You will be prompted to optionally clear secure storage credentials (API keys).

### Build Label
- **Format**:
  - Production/package builds: `IntelliNote5000 <package.json version> (<gitShortSha|timestamp>)`
  - Dev builds: `IntelliNote5000 dev (<gitShortSha|timestamp>)`
- **How it’s generated**: `tools/build-info.mjs` reads `package.json`, attempts `git rev-parse --short HEAD`, and falls back to a UTC timestamp if git metadata is unavailable.
- **Where it appears**:
  - **Settings → About** shows the full build label and platform.
  - **Export Diagnostics Bundle** includes `buildLabel`, `version`, `buildCommit`, and `buildTime`.
  - `npm run build:info` prints the label in the terminal.
- **When filing bugs**: Ask testers to open **Settings → About** and copy the build label (plus platform). This helps match issues to the exact build.

Add new providers by creating an adapter in `services/providers/` and surfacing it in Settings.

### Secure API Key Storage
- **Web**: LocalStorage fallback is opt-in via **Settings → Diagnostics & Storage**.
- **macOS Desktop (Tauri)**: Stored in the macOS Keychain through Tauri commands (`keyring` crate). No API keys are written to disk.
- **iOS/iPadOS (Capacitor)**: Stored via `capacitor-secure-storage-plugin`, backed by the iOS Keychain. After installing dependencies, run `npx cap sync ios` to copy the plugin into the native project before archiving.
- **Clear credentials**: Use **Settings → Clear All Credentials** to wipe cached keys and fallback storage.
- **Logging**: Provider keys are never logged; storage falls back to LocalStorage only when you explicitly opt in.

Use `npm run verify:providers` to ensure new provider configurations satisfy the automated checks.
Use `npm run verify:platforms` to confirm platform permission strings and native config files are in place before packaging native builds.

## Release Verification
Run the release verification script before packaging native builds:

```bash
npm run verify:release
```

This verifies native configuration files, permission strings, and required Capacitor/Tauri assets. Run linting, type checks, unit tests, and a production build before cutting a release. Fix any reported errors before cutting a release.

### CI Release Gate
Pull requests and pushes to `main` run linting, type checks, unit tests, a production build, and the release verification script via GitHub Actions. This blocks merges unless the project is package-ready.

## Packaging / Distribution

### macOS (Tauri)
1. Install deps: `npm install`
2. Build web assets: `npm run build`
3. Verify release prerequisites: `npm run verify:release`
4. **Unsigned/local build**: `npm run tauri:build:unsigned`
5. **Signed + notarized build**: `npm run tauri:build:signed`

Required environment variables for signed builds:
- `TAURI_MACOS_SIGNING_IDENTITY` (e.g., `Developer ID Application: Your Company (TEAMID)`)
- `TAURI_MACOS_PROVIDER_SHORT_NAME` (Apple Team ID)

Optional notarization variables (notarytool):
- `TAURI_NOTARIZE=1`
- `APPLE_ID`
- `APPLE_PASSWORD` (app-specific password)
- `APPLE_TEAM_ID`

Artifacts are written to `src-tauri/target/release/bundle`.

### macOS Test Distribution (Unsigned)
Run a single command to build and package unsigned tester artifacts (includes build label stamping):

1. `npm run package:mac:test`

Artifacts are written to `dist/testers`:
- `IntelliNote5000-mac-unsigned.zip`
- `IntelliNote5000-mac-unsigned.dmg` (plain DMG created with `hdiutil`, no Finder styling)
- `IntelliNote5000-mac-unsigned.sha256` (hashes for zip + dmg)
- `README-TESTERS.txt` (includes build label)
- `BUILD.txt` (build label, version, commit, build time)

These packages are unsigned and intended for limited testing only. Testers must use Gatekeeper’s “Open Anyway” flow to launch the app (right-click → Open, or System Settings → Privacy & Security → Open Anyway).

### iOS (Capacitor)
1. Generate the native project: `npm run native:ios:gen`
2. Open in Xcode: `npm run native:ios:open`
3. Configure signing (team, bundle ID, provisioning) and archive:
   - `npm run ios:archive` (prints Xcode + CLI guidance)

### Android (Capacitor)
1. Generate the native project: `npm run native:android:gen`
2. Open in Android Studio: `npm run native:android:open`
3. Configure signing in `android/` and build:
   - `npm run android:bundle:release` (AAB)
   - `npm run android:assemble:release` (APK)

## Production Checklist
- ✅ Configure AI + STT providers in Settings and verify credentials.
- ✅ Disable localStorage fallback unless you explicitly need it for web-only builds.
- ✅ Verify transcription permissions on each platform.
- ✅ Run `npm run verify:platforms` to confirm native config strings.
- ✅ Run `npm run lint`, `npm run typecheck`, and `npm run test:unit`.
- ✅ Run `npm run build` and `npm run tauri:build:unsigned` / `npm run native:ios:gen` / `npm run native:android:gen` as needed.
- ✅ Review **Settings → Diagnostics & Storage** for recent errors before release.

## Troubleshooting
- **AI requests fail**: Open the Diagnostics panel (Settings → Diagnostics) and confirm provider + error codes. Re-save your API key or regenerate it.
- **STT connection error**: Confirm your Deepgram key, ensure your network allows WebSocket connections, and verify mic permissions are granted.
- **Interim transcripts not updating**: Ensure the provider is configured for interim results and that the app stays in the foreground (backgrounding may auto-pause).
- **Keys not persisting on web**: Enable the localStorage fallback toggle in Settings.
- **Microphone blocked**: Check browser permissions or update native Info.plist/AndroidManifest entries.
- **Capacitor build fails with missing permissions**: Run `npm run verify:platforms` and `npx cap sync` to regenerate native projects.
- **Missing iOS/Android native projects**: Run `npm run native:ios:gen` or `npm run native:android:gen` before packaging.
- **Tauri signing/notarization errors**: Confirm `TAURI_MACOS_SIGNING_IDENTITY`, `TAURI_MACOS_PROVIDER_SHORT_NAME`, `APPLE_ID`, and app-specific password are set and that hardened runtime entitlements include microphone access.
- **Android build fails with foreground service errors**: Ensure `FOREGROUND_SERVICE` and `FOREGROUND_SERVICE_MICROPHONE` permissions are present after `npx cap sync`.

## Platform Permission Notes
- **macOS/iOS**: Add `NSMicrophoneUsageDescription` before shipping. Ensure entitlements permit microphone access.
- **iOS background audio**: `UIBackgroundModes` includes `audio` when background recording is required; remove it if you do not support background capture.
- **Android**: Declare `RECORD_AUDIO`, `FOREGROUND_SERVICE`, and `FOREGROUND_SERVICE_MICROPHONE` in `AndroidManifest.xml` after `npx cap sync`.
- **Web**: HTTPS is required for microphone access in most browsers.

## Release Steps
1. `npm install`
2. `npm run lint`
3. `npm run typecheck`
4. `npm run test:unit`
5. `npm run build`
6. `npm run verify:platforms`
7. Desktop: `npm run tauri:build:unsigned` or `npm run tauri:build:signed`
8. Mobile: `npm run native:ios:gen` / `npm run native:android:gen` → open Xcode/Android Studio for signing and release builds.

## Platform Build Steps

### Web
1. `npm install`
2. `npm run build`
3. Deploy `dist/` to your static host.

### macOS (Tauri)
1. `npm install`
2. `npm run build`
3. `npm run verify:platforms`
4. `npm run tauri:build:unsigned` or `npm run tauri:build:signed`
5. Use the output in `src-tauri/target/release/bundle/macos`.

### iOS (Capacitor)
1. `npm install`
2. `npm run build`
3. `npm run verify:platforms`
4. `npm run native:ios:gen`
5. `npm run native:ios:open`
6. Configure signing, update `Info.plist` if needed, and archive in Xcode.

### Android (Capacitor)
1. `npm install`
2. `npm run build`
3. `npm run verify:platforms`
4. `npm run native:android:gen`
5. `npm run native:android:open`
6. Configure signing and create a release build in Android Studio.

## Signing + Notarization (Placeholders)
- **macOS (Tauri)**:
  - [ ] Set `TAURI_MACOS_SIGNING_IDENTITY` and `TAURI_MACOS_PROVIDER_SHORT_NAME` and ensure hardened runtime + microphone entitlements are enabled.
  - [ ] Set `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`, and optionally `TAURI_NOTARIZE=1` before `npm run tauri:build:signed`.
  - [ ] Verify notarization status in the Apple developer portal.
- **iOS**:
  - [ ] Configure the Xcode project signing team, bundle ID, and provisioning profile.
  - [ ] Ensure `NSMicrophoneUsageDescription` and `UIBackgroundModes` (audio) are present when background recording is supported.
- **Android**:
  - [ ] Generate a keystore in `android/` (after `npx cap sync`) and set Gradle signing config.
  - [ ] Verify `RECORD_AUDIO` and foreground service permissions in `AndroidManifest.xml`.

## Provider Keys (Where to Set Them)
- **Recommended (all platforms)**: Settings → AI Provider + Transcription Provider.
- **Optional dev fallback**: `.env.local` (e.g., `VITE_API_KEY`, `VITE_AI_PROVIDER`, `VITE_AI_BASE_URL`).
- **Native secure storage**: Tauri keychain + Capacitor secure storage plugin (never written to disk).

### Build commands
- `npm run build` – production web bundle
- `npm run start-desktop` – Tauri dev for macOS
- `npm run tauri:build:unsigned` / `npm run tauri:build:signed` – Tauri release builds
- `npm run native:ios:gen` / `npm run native:ios:open` – Capacitor iOS generation + open
- `npm run native:android:gen` / `npm run native:android:open` – Capacitor Android generation + open
- `npm run start-mobile` – sync + open iOS workspace (use Xcode for device/archive builds)

### Mobile + Desktop Permissions
- **iOS/macOS**: Add a microphone usage description (`NSMicrophoneUsageDescription`) in the native project before archiving (`ios/App/App/Info.plist`, `src-tauri/tauri.conf.json`).
- **Android**: Ensure `RECORD_AUDIO` permission is declared in `android/app/src/main/AndroidManifest.xml` after `npx cap sync`.
- The app requests permissions at runtime via the browser media API. On mobile, interruptions (mute, unplug, backgrounding) automatically pause and resume recording when possible.

## Common Build Errors
- **Capacitor secure storage plugin missing**: run `npm install` and `npx cap sync` so the plugin is copied into `ios/` and `android/`.
- **iOS archive fails with microphone permission**: confirm `NSMicrophoneUsageDescription` in `Info.plist` and run `npm run verify:platforms`.
- **Android runtime permission denied**: ensure `RECORD_AUDIO` and foreground service permissions are in `AndroidManifest.xml`, then reinstall the app.
- **Tauri keychain access denied**: verify the app is signed and the hardened runtime is enabled with the microphone entitlement.

## Release Guides

- [Apple/macOS + iOS release checklist](docs/apple-release-checklist.md)
