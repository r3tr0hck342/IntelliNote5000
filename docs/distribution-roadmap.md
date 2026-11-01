# Distribution Roadmap: Desktop → Mobile → Tablet

Goal: a person can download IntelliNote, install it like any other app, and keep their notes safe. Desktop ships first; phone and tablet reuse the same web UI through Capacitor. Apple-specific signing/submission steps live in [apple-release-checklist.md](apple-release-checklist.md).

Status key: ✅ done · 🔲 to do · ⚠️ decision needed

## Current stack

| Layer | Tech | Notes |
| --- | --- | --- |
| UI | React 18 + Vite 7 + Tailwind | Single codebase for every platform |
| Desktop shell | Tauri 2 | macOS `.dmg`, Windows `.msi`/`.exe`, Linux `.deb`/`.AppImage`/`.rpm` |
| Mobile shell | Capacitor 8 | iOS/iPadOS + Android/tablets |
| Secrets | OS keychain (Tauri `keyring`), Keychain/Keystore (Capacitor plugin) | Users bring their own AI keys |
| Data | IndexedDB (sessions + audio) | See Phase 1.2 |

## Phase 0: Unblock the pipeline (≈ half a day remaining)

- ✅ `package-lock.json` re-synced (`npm ci` failed before, which broke CI on every PR)
- ✅ Security upgrades: Capacitor 6→8, Tauri 1→2, Vite 5→7, mermaid 10→12, `react-quill`→`react-quill-new` (Quill 2). Production vulns went from 2 critical + 10 high to 0 critical/high.
- ✅ `.npmrc` `legacy-peer-deps` removed (the secure-storage plugin now supports Capacitor 8)
- ✅ Desktop CSP allows OpenAI and drops dead CDN script sources
- ✅ Tauri permissions trimmed to least privilege (save dialog + file writes only)
- ✅ Desktop microphone: permission auto-granted in the webview (macOS still shows its system prompt); WebKitGTK media stream enabled on Linux
- ✅ PDF.js worker bundled locally (was loaded from a CDN, which the desktop CSP blocks)
- ✅ Unsigned macOS builds are ad-hoc signed, so Apple Silicon shows "Open Anyway" instead of "damaged"
- ✅ Placeholder app icons generated (`assets/app-icon.png` → `src-tauri/icons/`)
- ✅ `dist/` untracked from git
- ✅ Typecheck clean (19 pre-existing errors fixed, including a crash on opening the live recorder)
- ✅ Test runner switched from `ts-node --esm` to `tsx`; `npm test` runs unit, transcript and storage suites
- ✅ ESLint errors fixed (0 errors; unused-variable warnings remain)
- 🔲 Migrate to ESLint 9 flat config (clears the remaining dev-only moderate advisories)
- 🔲 Replace the placeholder icon with a real 1024×1024 PNG, then run `npx tauri icon <file>`

## Phase 1: Desktop that real users can install (≈ 1–2 weeks)

### 1.1 Builds (✅ scaffolded)
`.github/workflows/desktop-release.yml` builds all three OSes and attaches the installers to a **draft** GitHub Release.
- Trigger: push a tag (`git tag v0.2.0 && git push origin v0.2.0`) or run it manually from the Actions tab.
- CI (`ci.yml`) now also runs `cargo check` so PRs catch Rust breakage.

### 1.2 Data durability (✅ core fixed · 🔲 backup export)
- ✅ Sessions moved from `localStorage` (≈5 MB cap) to IndexedDB (`utils/localDb.ts`). Existing data migrates on first launch; the old copy is removed only after the IndexedDB write succeeds.
- ✅ Recorded audio is written to IndexedDB every second while recording, so a crash or closed window keeps everything up to that point. The old base64-audio-inside-the-session path (which could break saving for *all* sessions) is gone, and earlier inline audio is migrated.
- ✅ Failed loads/saves show an error toast. A failed load pauses saving so an empty list can never overwrite stored data.
- ✅ **Download audio** button next to the asset picker for live recordings (native save dialog on desktop).
- 🔲 **Export all / Import backup** (JSON + audio zip) so users can move between devices.
- 🔲 "Transcribe After Recording" only works in the same app run; after a restart, offer it from the session view using the saved audio.

### 1.3 Signing (🔲 needed before public release)
Unsigned builds work for testers but show scary OS warnings.

| OS | Needs | Cost | CI secrets to add |
| --- | --- | --- | --- |
| macOS | Apple Developer ID cert + notarization | $99/yr | `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` |
| Windows | Code-signing cert (Azure Trusted Signing is cheapest) | ~$10/mo | see https://v2.tauri.app/distribute/sign/windows/ |
| Linux | None required | — | — |

tauri-action reads the Apple env vars automatically once the secrets are wired into the workflow `env:`.

### 1.4 Auto-update (🔲)
- Add `tauri-plugin-updater` + `npx tauri signer generate`. Store the private key as the `TAURI_SIGNING_PRIVATE_KEY` secret.
- Set `bundle.createUpdaterArtifacts: true`. tauri-action then publishes `latest.json` with the release.

### 1.5 First-run experience (🔲)
- New users see an app that needs API keys before it does anything. Add a first-launch screen: pick provider → paste key → test call → done.
- ⚠️ Decision: the OpenAI provider supports a custom base URL (Azure/OpenRouter), but the desktop CSP only allows `api.openai.com`. Options: (a) document that custom endpoints are web-only, (b) widen `connect-src` to `https:` (weaker XSS containment), or (c) route AI calls through a Rust command so the CSP stays tight. **Recommend (c)** if custom endpoints matter.

### 1.6 Download page (🔲)
- A simple landing page with OS-detected download buttons pointing at the latest GitHub Release assets.

## Phase 2: Phones (≈ 1–2 weeks after Phase 1)

- 🔲 `android/` and `ios/` contain only a manifest and an Info.plist. They are not real Capacitor projects yet. Regenerate:
  1. Move `AndroidManifest.xml` and `Info.plist` aside
  2. `npm run build && npx cap add android && npx cap add ios`
  3. Merge the permission entries back in (mic, foreground service, background audio)
- 🔲 Delete `ios.infoPlist` / `android.permissions` from `capacitor.config.ts`. They are not valid Capacitor options (2 of the 19 typecheck errors) and do nothing at runtime. Point the string checks in `tools/verify-release.mjs` and `verification_scripts/verify_platforms.ts` at the native files instead.
- 🔲 Background recording: Android needs a foreground-service plugin or recording stops on screen lock. iOS needs `UIBackgroundModes: audio` (already in Info.plist).
- 🔲 Store accounts: Google Play ($25 one-time), App Store (same $99/yr Apple account as macOS).
- 🔲 CI: add an Android job (`./gradlew bundleRelease` with keystore secrets) and an iOS job on `macos-latest`.

## Phase 3: Tablet / iPad layout (≈ 1 week)

- 🔲 Responsive breakpoints: phone = single pane with tabs; tablet = two panes (transcript + notes); desktop = current layout.
- 🔲 `react-draggable` / `react-resizable` panels: verify touch dragging, enlarge handles to ≥44 px.
- 🔲 No-horizontal-scroll pass at 360 px width.
- 🔲 iPad: support Split View/Slide Over (all orientations) and hardware-keyboard shortcuts.

## Later / optional

- Cross-device sync (needs a backend + accounts; a big shift from bring-your-own-key).
- Quill 2.0.3 has a low-severity advisory (XSS via HTML export) with no patched release yet. Sanitize with DOMPurify before exporting HTML or injecting AI output into the editor.
- Remove `script-src 'unsafe-inline'` from the desktop CSP once `index.html` has no inline scripts.
