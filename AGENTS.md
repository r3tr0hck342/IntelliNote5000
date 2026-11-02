# IntelliNote5000: agent handoff

Last updated 2026-11-02. Read this first, then `docs/transcription-phase0-plan.md` and
`docs/transcription-security.md` for depth.

## Where things stand

- **Latest release:** `v0.1.0-rc.3` (pre-release, public):
  https://github.com/r3tr0hck342/IntelliNote5000/releases/tag/v0.1.0-rc.3
  Mac universal `.dmg`, Windows `.exe`/`.msi`, Linux `.deb`/`.AppImage`/`.rpm`. Unsigned.
- `v0.1.0-rc.2` is kept as a draft titled "[Archived] … (pre-transcription)". Do not delete it unless asked.
- On-device transcription Phases 0–5 are all merged (PRs #48–#53), plus #54 (macOS system-audio
  plist), #55 (Settings setup guides), #56 (installer artifacts and universal macOS sidecar fix).
- The repo auto-deletes merged branches.

## Who it's for

- **English only.** No multilingual work unless asked.
- The owner's son tests it in real college lectures **on macOS**. Expect secondhand bug reports:
  ask for what he clicked, what he expected, what happened, and the exact error text.
- The owner wants the best user experience with minimal setup. Free and on-device by default.

## What the app does (transcription)

```
mic / system audio ─► cpal capture ─► 16 kHz resample ─┬─► encrypted archive (WAV segments, AES-256-GCM)
                                                       └─► sidecar: Nemotron live text
stop ─► archive decrypted in memory ─► sidecar: Parakeet final pass ─► transcript replaces live text ─► notes pipeline
```

- **Sidecar** `src-tauri/asr` (crate `intellinote-asr`, `sherpa-onnx =2.0.1`) talks over stdin/stdout
  only. Frames are `[u32 LE len][u8 kind][payload]`: kind 1 JSON, kind 2 live PCM f32, kind 3 WAV archive segment.
  Requests: `hello`, `transcribeFile`, `startStream`/`stopStream`, `startFinal`/`endFinal`, `benchmark`, `shutdown`.
- **Models** (`src-tauri/transcription-models.json`, pinned URLs and SHA-256, re-verified before every load):
  Parakeet TDT 0.6B v3 int8 (final pass, CC-BY-4.0), Nemotron streaming EN 0.6B 560 ms int8
  (live text, NVIDIA Open Model License), Silero VAD (MIT). About 1.2 GB, downloaded on first use.
- **App side** `src-tauri/src/transcription/`: `catalog`, `models` (download/install), `sidecar`
  (spawn, frames, watchdog, ffmpeg fallback), `recording` (capture, `finalize`), `archive`, `crypto`
  (key in OS keychain), `tier` (benchmark → high/mid/below-floor; below-floor = record-only),
  `commands` (Tauri commands).
- **UI:** `components/NativeLiveRecorder.tsx` (desktop live recording, finalizing progress, tier line),
  `components/SettingsModal.tsx` with `SetupGuideCard.tsx` and `services/setupGuides.ts`
  (per-provider cost, steps, key links), `utils/openExternal.ts` (links via `tauri-plugin-opener`, https only).

## Commands

```bash
npm run tauri dev              # desktop app (builds the sidecar first)
npm run build:asr              # sidecar only → src-tauri/binaries/intellinote-asr-<triple>
npx tsc --noEmit && npm run lint && npm test && npm run build
(cd src-tauri && cargo test)       # app (20 tests)
(cd src-tauri/asr && cargo test)   # sidecar (12 tests)
# Golden WER tests with real models (fetch with tools/fetch-test-models.mjs into ~/.cache/intellinote-models):
#   in src-tauri/asr:
INTELLINOTE_MODELS_DIR=~/.cache/intellinote-models cargo test --release --test golden -- --ignored
#   in src-tauri (end-to-end archive → final pass):
INTELLINOTE_MODELS_DIR=~/.cache/intellinote-models INTELLINOTE_ASR_BIN=$PWD/asr/target/release/intellinote-asr \
  cargo test -- --ignored golden_final_pass
```

- Linux build needs: `libwebkit2gtk-4.1-dev libdbus-1-dev libasound2-dev`.
- Lint baseline: 0 errors, 6 pre-existing warnings.

## Releasing

1. Merge to `main`.
2. `git tag -a v0.1.0-rc.N -m "..." && git push origin v0.1.0-rc.N`. This runs `.github/workflows/desktop-release.yml`.
3. The workflow drafts a release with all installers (about 20 min). Check the assets, then
   `gh release edit <tag> --draft=false --prerelease --notes ...`.
- A manual run (`gh workflow run desktop-release.yml --ref <branch>`) uploads installers as run
  artifacts instead of drafting a release.

## Decisions (don't relitigate without a reason)

- Sidecar over stdin/stdout; no sockets.
- Archive segments are **WAV**, not FLAC: flacenc 0.5.1 output fails symphonia 0.6.1's probe.
- Final pass never deferred on battery; uses 2 threads on battery, up to 4 on AC.
- No eco mode (it would need a second 464 MB model and restart the stream mid-lecture).
- No hotwords: sherpa-onnx 2.0.1 needs a `bpe.vocab` the model archives don't ship
  (`csrc/utils.cc:104` @ v2.0.1).
- No whisper.cpp engine stub.
- Cloud transcription has no unlimited free tier. On-device is the free and unlimited path; paid
  fallbacks are the OpenAI `whisper-1` preset and Deepgram.

## Open items (most useful first)

1. **Field-test feedback from macOS.** Untested on real Mac hardware: system-audio loopback
   (needs macOS 14.6+, permission prompt), first-launch Gatekeeper flow, model download.
2. **"Retry final transcript" button** for crashed or failed sessions. The archive stays on disk,
   but no UI re-runs `recording_finalize` on it yet.
3. Windows installer is 11 MB: confirm `intellinote-asr.exe` is inside before recommending Windows.
4. Tier cache (`transcription-tier.json`) is never re-measured after hardware changes.
5. Apple signing and notarization (`docs/apple-release-checklist.md`) to remove the "Open Anyway" step.
6. Older codebase-review findings (chat XSS, reconnect closure, orphaned audio): verify against
   current code before acting.

## Working rules from the owner

- One phase or feature per branch and PR. Pin every dependency exactly; never "latest".
- Never invent APIs: read the crate or library source (or the pinned upstream tag) and cite it.
- Don't weaken security controls, lint rules, or CI gates.
- No transcript text or audio paths in logs, errors, or telemetry.
- Conventional commits (`feat:`, `fix:`, `docs:`, `ci:`). Merge only after CI is green; the owner merges.
