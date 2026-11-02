# Third-party notices

IntelliNote includes or downloads the third-party components below for on-device transcription.
Licenses were read from each package's published metadata or official repository; see
`docs/transcription-phase0-plan.md` §2 for sources.

## Speech models (downloaded on first use, not bundled)

| Model | License | Required notice |
|---|---|---|
| **Parakeet TDT 0.6B v3** (int8 ONNX export by the sherpa-onnx project), `parakeet-tdt-0.6b-v3-int8` | **CC BY 4.0** | Attribution: "Parakeet TDT 0.6B v3 by NVIDIA, licensed under CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). Converted to ONNX by the sherpa-onnx project (k2-fsa)." This model is the source of truth for transcripts used by the notes pipeline. |
| **Silero VAD** (`silero_vad.onnx`) | **MIT** | Copyright (c) Silero Team. https://github.com/snakers4/silero-vad |

Models are fetched from pinned URLs under `https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/` and verified against pinned SHA-256 digests (`src-tauri/transcription-models.json`) before every load.

## Bundled software (ASR sidecar `intellinote-asr`)

| Component | Version | License |
|---|---|---|
| sherpa-onnx (Rust crate + prebuilt static libraries) | 2.0.1 | Apache-2.0 |
| ONNX Runtime (statically linked inside the sherpa-onnx libraries) | as shipped by sherpa-onnx 2.0.1 | MIT |
| symphonia (audio decoding) | 0.6.1 | MPL-2.0 (unmodified; source at https://github.com/pdeljanov/Symphonia) |

## Bundled software (app)

| Component | Version | License |
|---|---|---|
| tar | 0.4.46 | MIT OR Apache-2.0 |
| bzip2 | 0.6.1 | MIT OR Apache-2.0 |
| zod | 4.6.7 | MIT |

## Planned (later phases, not yet included)

| Component | License | Notes |
|---|---|---|
| NVIDIA Nemotron Speech Streaming EN 0.6B / Nemotron 3.5 ASR Streaming | NVIDIA Open Model License | Must ship a copy of the Agreement and the notice "Licensed by NVIDIA Corporation under the NVIDIA Open Model License". Includes guardrail and patent-litigation termination clauses; NVIDIA may update the terms. Full text to be re-read before Phase 2 ships. |
| whisper.cpp | MIT | Fallback engine stub only. |

## Commercial distribution review

- **No blocker found for Phase 1.** CC BY 4.0 requires attribution (above); MIT and Apache-2.0 require these notices.
- **MPL-2.0 (symphonia)** is file-level copyleft: it applies only if symphonia's own source files are modified. They are not.
- **ffmpeg is not bundled.** It is used only if the user already has it installed (fallback for formats such as Opus), so no LGPL/GPL obligations arise from distribution.
