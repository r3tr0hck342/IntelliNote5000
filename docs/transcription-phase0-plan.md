# On-device transcription: Phase 0 plan

Status: **proposal, awaiting approval**. No code has been written for this feature.
Snapshot date for all external facts: 2026-11-01. Every external claim cites its source; anything not confirmed from a primary source is marked **(verify)** and is resolved at the start of the phase that needs it.

---

## 1. What the repo is today

| Area | Current state | Where |
|---|---|---|
| Framework | **Tauri 2** desktop shell (Rust) + **React 18 / TypeScript / Vite 7** UI. Capacitor 8 for mobile, but `ios/` and `android/` are not generated yet. | `src-tauri/`, `App.tsx`, `capacitor.config.ts` |
| Languages | TypeScript (UI, services), Rust (keychain commands, mic permission, HTTP plugin) | |
| Target OSes | macOS, Windows, Linux desktop (CI builds all three); web build; mobile later | `.github/workflows/desktop-release.yml` |
| Audio capture | **Browser APIs only.** `getUserMedia` → deprecated `ScriptProcessorNode` → 16 kHz Int16 frames → cloud STT. A parallel `MediaRecorder` writes webm/opus chunks to IndexedDB every 1 s. No system-audio capture. | `components/LiveNoteTaker.tsx` |
| STT abstraction | `StreamingSttProvider { createSession, transcribeAudio }` with Deepgram (WebSocket) and Whisper (chunked HTTP: Groq / local server). Both send audio off-device. | `services/stt/` |
| Storage | **IndexedDB**: one `sessions` JSON blob (`StudySession` → `LectureAsset` → `TranscriptSegment[]`) and an `audioChunks` store. **No encryption at rest.** API keys are in the OS keychain (`keyring` crate). | `utils/localDb.ts`, `utils/sessionStorage.ts`, `src-tauri/src/secure_storage.rs` |
| Transcript type | `TranscriptSegment { id, assetId, startMs, endMs, text, isFinal, confidence?, speaker?, utteranceId?, createdAt }` | `types.ts` |
| Notes pipeline entry | `runAiPipeline(session)` in `App.tsx`: concatenates final segments of all assets and calls `processTranscript` / `generateTags` / `generateFlashcards` (`services/aiService.ts`). It reads only `TranscriptSegment[]` via `getTranscriptText`, so it is already engine-agnostic. | `App.tsx`, `services/aiPrompts.ts` |
| File import | Text transcripts only (`.txt`/`.md`, SRT/VTT timestamps parsed). **No audio/video import.** | `components/FileUploadModal.tsx`, `utils/transcript.ts` |
| Tests | Plain `tsx` assertion scripts (`npm test`): unit, transcript pipeline, IndexedDB storage. No Rust tests. | `verification_scripts/` |
| CI | `ci.yml`: lint, typecheck, test, build, `verify:release`, `cargo check` (ubuntu-22.04). `desktop-release.yml`: tauri-action for macOS (**`universal-apple-darwin`**), Windows, Linux. **No secrets scanning exists today.** | `.github/workflows/` |
| Security baseline | CSP `script-src 'self'`; least-privilege Tauri capabilities; provider HTTP via `tauri-plugin-http` (scope: HTTPS anywhere, HTTP to localhost only); plain HTTP to non-local hosts refused in code. | `src-tauri/tauri.conf.json`, `src-tauri/capabilities/default.json`, `utils/http.ts` |

Branch note: the most recent work (8 AI providers, Whisper adapter, keychain fix, Linux fixes) is on `feat/more-providers-free-stt`, **pushed but not merged**. This plan assumes it lands on `main` first, because Phase 1 builds on its `services/stt` registry and `tsconfig` fix.

---

## 2. Verified external facts

| Fact | Source |
|---|---|
| Official Rust crate `sherpa-onnx`, latest **2.0.1** (2026-10-27); 2.0.0 (2026-10-23); 1.13.8 (2026-09-11). Default feature `static`; `shared` optional. | <https://crates.io/api/v1/crates/sherpa-onnx>, <https://k2-fsa.github.io/sherpa/onnx/rust-api/install.html> |
| The crate's build script downloads prebuilt libs from `https://github.com/k2-fsa/sherpa-onnx/releases/download/v2.0.1/<name>`: `linux-x64`, `linux-aarch64`, `osx-x64`, `osx-arm64`, `win-x64`, `win-arm64` static archives. **No macOS universal archive.** `SHERPA_ONNX_LIB_DIR` / `SHERPA_ONNX_ARCHIVE_DIR` override the download. | <https://docs.rs/sherpa-onnx/latest/sherpa_onnx/> |
| Rust API: `OnlineRecognizer`, `OnlineStream::accept_waveform(sample_rate, &[f32])`, `input_finished`, `set_option`; `OfflineRecognizer`/`OfflineStream`; `VoiceActivityDetector`, `SileroVadModelConfig`; `LinearResampler`; `Wave::read` (WAV only). `OnlineRecognizerConfig` has `decoding_method`, `max_active_paths`, `hotwords_file`, `hotwords_buf`, `hotwords_score`, endpoint rules. | <https://docs.rs/sherpa-onnx/latest/sherpa_onnx/struct.OnlineRecognizerConfig.html>, <https://docs.rs/sherpa-onnx/latest/sherpa_onnx/struct.OnlineStream.html> |
| 2.0.0 includes "Support modified_beam_search with hotwords for streaming NeMo transducer models (#3895)". Before that, Nemotron streaming was greedy-only (issue #3572, closed 2026-09-14). 2.0.0 also changed `SherpaOnnxCreate*` to return NULL instead of throwing (#4044) and fixed a long-stream VAD SIGSEGV (#4079). | <https://github.com/k2-fsa/sherpa-onnx/releases/tag/v2.0.0>, <https://github.com/k2-fsa/sherpa-onnx/issues/3572> |
| Nemotron EN streaming int8 models, separate archive **per chunk size** (80 / 160 / **560** / **1120** ms), dated 2026-04-25, e.g. `sherpa-onnx-nemotron-speech-streaming-en-0.6b-560ms-int8-2026-04-25.tar.bz2` under the `asr-models` release tag. 560 ms unpacked: `encoder.int8.onnx` 623 MB, `decoder.int8.onnx` 6.9 MB, `joiner.int8.onnx` 1.7 MB, `tokens.txt`. Sample RTF 0.16 on 1 thread. "The larger the chunk size, the higher the accuracy." | <https://k2-fsa.github.io/sherpa/onnx/nemo/nemotron-streaming.html> |
| Nemotron 3.5 ASR streaming (multilingual, 40 locales; 19 good out of the box), dated 2026-06-11, same four chunk sizes; language chosen per stream with `set_option("language", …)` or `auto`. 560 ms encoder 627 MB. | same page |
| Parakeet TDT 0.6B v3 int8: `https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8.tar.bz2`, 25 European languages, unpacked 640 MB (encoder 622 MB). Output has per-**token** timestamps; `words` is empty in the sample. | <https://k2-fsa.github.io/sherpa/onnx/pretrained_models/offline-transducer/nemo-transducer-models.html> |
| Hotwords for offline NeMo transducers: modified beam search + hotwords since 1.12.24 (#3077), fixed in 1.13.1 (#3589). | <https://github.com/k2-fsa/sherpa-onnx/blob/master/CHANGELOG.md> |
| `cpal` latest **0.18.2** (2026-08-16), Apache-2.0. macOS loopback: "Support for loopback recording … on macOS > 14.6" (0.17.0) with fixes in 0.18.0. 0.18.0 adds native **PipeWire** and **PulseAudio** hosts (optional features). Windows WASAPI loopback and Linux monitor-source capture: **not stated in README/CHANGELOG (verify in source)**. | <https://github.com/RustAudio/cpal/blob/master/CHANGELOG.md> |
| Licenses: sherpa-onnx Apache-2.0; Parakeet CC-BY-4.0 (attribution required); Nemotron: NVIDIA Open Model License (commercial use allowed; must ship the Agreement + a notice "Licensed by NVIDIA Corporation under the NVIDIA Open Model License"; guardrail-bypass and patent-suit termination clauses; NVIDIA may update terms) **(verify the full text; the fetch returned a summary)**; Silero VAD MIT; whisper.cpp MIT. | <https://www.nvidia.com/en-us/agreements/enterprise-software/nvidia-open-model-license/>, <https://github.com/snakers4/silero-vad>, <https://github.com/ggml-org/whisper.cpp> |

Your requirement "sherpa-onnx ≥ 1.13.4" is met by pinning **2.0.1**. The docs do not mention the silent-misdecode issue themselves; the golden-audio WER gate (§7) is what catches that class of regression.

---

## 3. Integration choice: Rust sidecar over stdin/stdout

**Recommendation: a separate Rust executable `intellinote-asr`** that links `sherpa-onnx = "=2.0.1"` statically, launched by the Tauri main process as a sidecar. They talk over **stdin/stdout with length-prefixed binary frames**. There is **no socket at all**. Capture and archiving stay in the Tauri main process.

Why not in-process, even though the app is already Rust:

- **Fault isolation is a hard requirement.** "Kill the recognizer mid-session; the archive stays intact and recording continues in record-only mode." An ONNX Runtime crash (it parses ~620 MB of untrusted model input) inside the Tauri process would take capture and the archive writer down with it. A separate process makes the recognizer killable and restartable, so the fault-injection test is real.
- **Memory is bounded per process.** Nemotron plus Parakeet is about 1.3 GB of weights. The final pass can run in a short-lived sidecar that exits and returns its memory.
- **No network attack surface.** stdin/stdout is reachable only by the parent process, so the WebSocket requirements (token, Origin check, CWE-1385 DNS rebinding) never apply.

Costs:
- Tauri `externalBin` needs per-target-triple binary names.
- On macOS, the sidecar must be signed and notarized too.
- Universal macOS builds need `lipo` (see risk R3).

```
Tauri main process (Rust)                          intellinote-asr (sidecar, Rust + sherpa-onnx)
┌───────────────────────────────────────────┐      ┌──────────────────────────────────────┐
│ capture (cpal: mic / loopback)            │      │ VAD (Silero)                         │
│   → resample 16 kHz mono f32              │      │ OnlineRecognizer (Nemotron, 1 stream)│
│   → bounded queue ──┬──► archive writer   │ PCM  │ OfflineRecognizer (Parakeet, final)  │
│                     └──► ASR client ──────┼─────►│ model manager: SHA-256 before load   │
│ archive: FLAC segments, .partial → rename │◄─────┤ partial/final results, stats         │
│ backpressure state machine, tier, battery │ JSON └──────────────────────────────────────┘
│ Tauri Channel → UI (partials, finals, lvl)│
└───────────────────────────────────────────┘
```

Audio never enters the webview. The UI gets text and levels over a Tauri `ipc::Channel`.

**Web and mobile builds keep the current browser path.** The local engine is desktop-only, and engine selection happens behind the interface in §4.

---

## 4. Engine interface and transcript schema

TypeScript, in `services/transcription/`:

```ts
interface TranscriptionEngine {
  startStream(opts: { language: string; hotwords?: string[]; chunkMs: 560 | 1120 }): StreamHandle;
  transcribeFile(path: string, opts: FileOpts): Promise<Transcript>;
  capabilities(): Promise<EngineCaps>; // rtf, providers (cpu/coreml/directml/cuda), languages, tier
}
```

- `LocalSherpaEngine` calls Tauri commands that drive the sidecar.
- `RemoteEngine` wraps today's Deepgram/Whisper providers behind a feature flag. It is **off by default**, and turning it on is an explicit opt-in because audio leaves the device.

Transcript schema, validated with **Zod** on the TS side and `serde` with `deny_unknown_fields` on the Rust side:

```
Transcript { engine, modelVersion, language, segments: Segment[] }
Segment    { id, start, end, text, isFinal, words: { w, start, end, conf? }[] }
```

`conf` is optional because sherpa-onnx returns token timestamps but per-word confidence is not documented **(verify)**. Words are built by merging BPE tokens on the `▁` word-start marker.

**Mapping to storage:** `TranscriptSegment` gains optional `words`, `engine`, and `modelVersion`. `SESSION_SCHEMA_VERSION` goes 1 → 2 with a no-op migration. The notes pipeline keeps reading `TranscriptSegment[]` through `getTranscriptText`, so **it doesn't change and never learns which engine ran**.

---

## 5. Phase-by-phase scope

Each phase gets its own branch and PR. Before starting a phase I'll restate its files, dependencies, schema changes, and security impact, and resolve its **(verify)** items.

### Phase 1: engine interface, model manager, Parakeet file transcription
- **Files:**
  - `src-tauri/asr/` is a new crate holding the sidecar binary.
  - `src-tauri/src/transcription/`: sidecar supervisor, model manager, Tauri commands.
  - `services/transcription/`: interface, Zod schema, `LocalSherpaEngine`.
  - `types.ts`: optional fields, schema v2.
  - `components/FileUploadModal.tsx`: adds audio/video import.
  - `THIRD_PARTY_NOTICES`
  - CI workflows
- **Model manager:**
  - Pinned URL plus **SHA-256 of each archive and of each extracted `.onnx`**, computed once from the official release and committed.
  - Resumable download with HTTP Range into `<app_data>/models/<name>/`, with progress events.
  - Verification runs before every load, and the model is refused on mismatch.
  - Extraction guards against path traversal: no absolute paths, `..`, or symlinks.
- **File import:** decode to 16 kHz mono, then run Parakeet with `OfflineRecognizer`. Long files are split on Silero VAD boundaries with a 30 s maximum, so memory stays bounded.
- **Decoder decision (D3):** your spec says an ffmpeg subprocess. I propose **`symphonia` (pure Rust, MPL-2.0) for audio and MP4/M4A**, plus ffmpeg as an *optional* subprocess when it is already installed, for other video. When ffmpeg is used, it gets explicit args (`Command::new(path).args([...])`) and no shell. Bundling ffmpeg adds about 80 MB per platform plus LGPL/GPL obligations.
- **Tests:**
  - Unit tests: Zod schema, SHA-256 verification with a good and a tampered fixture, extraction guards.
  - Golden-audio WER test for Parakeet (§7).
  - Secrets scanning: gitleaks, pinned by commit SHA, because none exists today.

### Phase 2: capture, archive, VAD, live Nemotron, live UI
- **Capture:** `cpal =0.18.2`.
  - Mic works on all OSes.
  - Loopback on macOS 14.6+ uses cpal's Core Audio tap. Older macOS falls back to ScreenCaptureKit **(verify crate)**.
  - Windows WASAPI loopback and Linux PipeWire/Pulse monitor sources are **(verify in cpal source)**. If cpal lacks one, I add a thin per-OS module.
  - Resampling to 16 kHz mono f32 uses `rubato` **(verify license/version)**. sherpa's `LinearResampler` is the no-new-dependency fallback, but it aliases more.
- **Archive:**
  - Always on. 60 s **FLAC** segments (`flacenc`, **verify license**) with `seg-000123.flac.partial` → fsync → atomic rename, plus an atomically rewritten `manifest.json`.
  - At 16 kHz mono FLAC that is about 1 MB/min, or about 90 MB for 90 minutes.
  - The archive runs ahead of the recognizer queue, so ASR failure never loses audio.
- **Live recognition:** Silero VAD gates speech into **one persistent Nemotron 560 ms stream per recording**. Partials go to the UI as provisional text and endpoint finals as committed text.
- **UI:** source picker (mic / system audio), level meter with a low-level warning, provisional vs committed styling, and autoscroll that pauses when you scroll. A "record-only" banner shows when recognition is off. Recording status is persisted so it survives a reload.
- **Replaces** the `ScriptProcessorNode` path on desktop. The web build is unchanged.

### Phase 3: final pass and handoff
- After stop, Parakeet runs over the archive in a fresh sidecar. On machines under 16 GB this is strictly sequential. The UI shows "Finalizing transcript" with progress, then swaps the live segments for the final ones.
- The final transcript is written to the session and existing `runAiPipeline` is called. On battery, the final pass is deferred until AC power is connected.

### Phase 4: adaptive performance
- **First-run benchmark:** runs Nemotron on a bundled 10 s clip. It records RTF, cores, RAM, AVX2 or Apple Silicon, and the available ONNX Runtime providers, then persists a tier: `high | mid | below-floor`.
- **Backpressure state machine:** `normal → eco → record-only`, driven by queue depth.
- **Battery detection:** `starship-battery` or a per-OS API **(verify)**.

### Phase 5: hotwords, multilingual, notices, security doc
- **Per-course glossary:**
  - Live: `hotwords_buf` with `decoding_method = "modified_beam_search"`. Supported for streaming NeMo since 2.0.0 (#3895), so it is not a notes-only fallback.
  - Final pass: same for offline NeMo (#3077).
- **Multilingual:** Nemotron 3.5 streaming for live. A whisper.cpp stub stays behind the interface until needed.
- **Docs:** `docs/transcription-security.md` (STRIDE, §8) and completed `THIRD_PARTY_NOTICES`.

---

## 6. New dependencies (all pinned with `=`)

| Dependency | Where | Why | Size impact |
|---|---|---|---|
| `sherpa-onnx =2.0.1` (+ `sherpa-onnx-sys`) | sidecar | ASR, VAD, offline/online recognizers | Static libs incl. ONNX Runtime: about 30–40 MB per platform in the sidecar binary **(measure)** |
| `cpal =0.18.2` | main | mic + loopback capture | small |
| `rubato` **(pin after verify)** | main | 48 → 16 kHz resampling | small |
| `flacenc` **(verify license, pin)** | main | archive segments | small |
| `symphonia` **(pin)** | sidecar | decode imported audio/MP4 | about 1–2 MB |
| `sha2`, `reqwest` (already transitive via `tauri-plugin-http`), `tar`, `bzip2` **(pin)** | main | model download, verify, extract | small |
| `zod` **(pin)** | UI | transcript schema validation | about 15 KB gzipped |
| Models (downloaded, not bundled) | app data dir | Nemotron EN 560 ms (~630 MB), Parakeet v3 (~640 MB), Silero VAD (~2 MB **(verify asset URL)**). Optional: Nemotron 1120 ms (eco), Nemotron 3.5 (multilingual). | 1.3 GB on first use |

---

## 7. Testing and CI gates

- **Fast CI (every PR)**, using the existing `npm test` style plus `cargo test` for the new crates:
  - Unit tests: schema, tier selection, backpressure state machine, SHA-256 good and tampered, atomic archive writes including a simulated crash between `.partial` and rename.
  - Sidecar protocol framing tests.
- **Model CI** (separate workflow; runs on PRs touching `src-tauri/asr/**` or `services/transcription/**`, plus nightly). Models are cached with `actions/cache`, keyed by SHA-256.
  - **Golden-audio WER:** uses the `test_wavs` shipped inside the official model archives, whose references come from LibriSpeech, CC-BY-4.0 **(verify per archive)**. Thresholds are set from a baseline run plus a margin. This catches silent runtime regressions such as the pre-1.13.4 Nemotron misdecode.
  - **60-minute synthetic stream:** looped clips; asserts sidecar RSS growth stays under a bound.
  - **Fault injection:** SIGKILL the sidecar mid-session. Asserts the archive manifest and segments are intact, the main process switches to record-only, and capture keeps going.
- **Unchanged:** existing lint, typecheck, tests, build, `verify:release`, and `cargo check`.
- **New:** gitleaks secrets scan.
- No socket exists, so the socket security tests are N/A. The design doc records why.

---

## 8. Security and privacy

**STRIDE summary.** The full version goes in `docs/transcription-security.md` in Phase 5.

| Threat | Mitigation |
|---|---|
| Spoofing a recognizer | No listening socket. The sidecar is spawned by absolute path from the app bundle and talks only over inherited stdin/stdout. |
| Tampered model files | Pinned SHA-256 per archive and per file, verified before every load. Mismatch means refuse and re-download. |
| Malicious archive (path traversal) | Extraction rejects absolute paths, `..`, and links. |
| Info disclosure (logs) | No transcript text or file paths in logs, toasts, or diagnostics bundles. Logged events carry codes and counts only, enforced by a test on `buildDiagnosticsBundle`. |
| DoS by long input | Bounded queues and VAD-split chunks. The sidecar's memory is isolated, and a kill falls back to record-only. |
| Privilege | The sidecar gets no Tauri capabilities. The Tauri `shell` permission is scoped to that one binary with no arguments from the UI. |

**Privacy:**
- Local engine by default on desktop.
- Cloud STT (Deepgram/Groq) becomes an explicit opt-in.
- A first-recording consent notice: institution policy and local consent laws apply, and the user is responsible for getting permission.

**Important conflict (D6):** the existing **notes pipeline sends transcript text to the configured AI provider**. That is cloud, unless you use Ollama. "Transcripts never leave the device" is therefore only true with Ollama. I propose a clear notice in Settings and at first AI use, rather than blocking cloud AI.

**Encryption at rest (D4):** the app has no encryption layer today. I propose:
- A per-install 256-bit key in the OS keychain (existing `keyring` crate).
- AES-256-GCM via RustCrypto `aes-gcm` for **archive segments and final transcript files** written by Rust (Phase 2/3).
- Encrypting the existing IndexedDB session store is a larger migration, so I propose it as a separate follow-up rather than doing it silently.

---

## 9. Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | **Eco mode means a different model, not a setting.** 560 ms and 1120 ms are separate ~630 MB exports, and switching mid-recording needs a new stream (loses encoder context). | Default 560 ms. Download the 1120 ms model only if eco is enabled. When backpressure steps up mid-session, restart the stream at a VAD silence boundary, otherwise go record-only. **Decision D5.** |
| R2 | System-audio loopback support in cpal is confirmed only for macOS 14.6+. | Verify cpal source in Phase 2. Per-OS fallback module if needed. Loopback ships after mic if it slips. |
| R3 | No universal macOS sherpa-onnx archive, but the release workflow builds `universal-apple-darwin`. | Build the sidecar per-arch with `SHERPA_ONNX_LIB_DIR` and `lipo` it, or switch to separate arm64/x64 macOS release artifacts. |
| R4 | 1.3 GB first-run download. | Explicit size and progress, resumable. Recording works immediately in record-only mode while models download. |
| R5 | NVIDIA Open Model License can be updated by NVIDIA, and it has guardrail/termination clauses. | Ship the Agreement and Notice, re-check on each model bump, and keep Parakeet (CC-BY-4.0) as the source of truth for notes. **Not a blocker for commercial distribution, per the summary I read (verify the full text).** |
| R6 | ffmpeg licensing if bundled. | Optional system ffmpeg only (D3). |
| R7 | The deprecated `ScriptProcessorNode` stays on the web path. | Out of scope. Desktop moves to Rust capture. |
| R8 | CPU-only GitHub runners make model CI slow. | Single-threaded RTF is about 0.16 per the docs, so roughly 2–4 min per golden run. Nightly for the 60-minute test. |

---

## 10. Decisions needed before Phase 1

| # | Decision | My recommendation |
|---|---|---|
| D1 | Sidecar (stdin/stdout) vs in-process link | **Sidecar.** It is required for real fault isolation. |
| D2 | Merge `feat/more-providers-free-stt` to `main` first | **Yes**, then branch Phase 1 from `main`. |
| D3 | Imported-file decoding | **symphonia, plus optional system ffmpeg.** No bundled ffmpeg. |
| D4 | Encryption at rest scope | **New archive and transcript files now.** IndexedDB in a separate follow-up. |
| D5 | Eco/backpressure behavior given separate models | **560 ms default**, 1120 ms on demand, restart at silence, else record-only. |
| D6 | Cloud AI notes vs "never leaves the device" | **Notice, not a block.** Ollama is the fully local path. |
| D7 | Cloud STT providers (Deepgram/Groq) | **Keep them, behind an explicit opt-in.** Local is the default on desktop. |
