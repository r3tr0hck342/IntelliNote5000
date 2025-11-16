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
4. Launch `http://localhost:1420`, open **Settings → AI Provider**, choose Gemini or OpenAI, and paste your API key. Keys are stored locally (browser localStorage or secure storage in native shells) so every user supplies their own credentials.
5. Allow microphone access if you plan to use live transcription (Gemini provider only).
6. `npm install` is configured with `legacy-peer-deps=true` (see `.npmrc`) so the Capacitor secure storage plugin can coexist with Capacitor 6 until the upstream publishes updated peer constraints.

### AI Provider Support

| Provider | Features | Notes |
| --- | --- | --- |
| Google Gemini | ✅ Notes, study guide, questions, flashcards, tags, chat, **live transcription** | Requires Gemini API key. Live features need Gemini due to the browser streaming SDK. |
| OpenAI (Chat Completions-compatible) | ✅ Notes, study guide, questions, flashcards, tags, chat, transcript editing | Uses GPT-4o-mini / GPT-4o by default. Provide a custom base URL if routing through a proxy such as Azure/OpenRouter. |

Add new providers by creating an adapter in `services/providers/` and surfacing it in Settings.

### Secure API Key Storage
- **Web**: Stored in localStorage (development only).
- **macOS Desktop (Tauri)**: Stored in the macOS Keychain through Tauri commands (`keyring` crate). No API keys are written to disk.
- **iOS/iPadOS (Capacitor)**: Stored via `capacitor-secure-storage-plugin`, backed by the iOS Keychain. After installing dependencies, run `npx cap sync ios` to copy the plugin into the native project before archiving.

Use `npm run verify:providers` to ensure new provider configurations satisfy the automated checks.

### Build commands
- `npm run build` – production web bundle
- `npm run start-desktop` / `npm run build-desktop` – Tauri dev/build for macOS
- `npm run sync-mobile` – rebuild web assets + sync to Capacitor native shells
- `npm run start-mobile` – sync + open iOS workspace (use Xcode for device/archive builds)

## Release Guides

- [Apple/macOS + iOS release checklist](docs/apple-release-checklist.md)
