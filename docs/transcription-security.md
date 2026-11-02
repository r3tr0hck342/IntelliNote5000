# On-device transcription: security and privacy

Scope: native recording, the `intellinote-asr` sidecar, model download, the encrypted archive,
and the final pass. Cloud transcription is separate and opt-in.

## Data flow

```
mic / system audio ─► cpal capture ─► resample 16 kHz ─┬─► encrypted archive (disk)
                                                       └─► sidecar stdin (live text)
stop ─► archive decrypted in memory ─► sidecar stdin (final pass) ─► transcript ─► notes pipeline
```

- The sidecar is a child process that talks only over stdin/stdout (`[u32 len][u8 kind][payload]`,
  max frame 8 MB in the sidecar, 64 MB in the app). It opens no sockets.
- Audio and transcripts never leave the device unless the user turns on a cloud feature.

## Assets

| Asset | Where | Protection |
|---|---|---|
| Recorded audio | `app_data/recordings/<asset_id>/seg-*.wav.enc` | AES-256-GCM, random 96-bit nonce per segment, format `INA1 \| nonce \| ciphertext`. Dirs 0700. |
| Recording key | OS keychain (service `IntelliNoteSecureConfig`, account `recording_key`) | Never written to disk or logs. |
| Transcripts | Existing session store | Existing app storage controls. |
| Speech models | `app_data/models/<id>/` | Pinned URL + archive SHA-256 + per-file SHA-256, checked again by the sidecar before every load. |

## STRIDE

| Threat | Example | Mitigation | Code |
|---|---|---|---|
| **Spoofing** | Swapped sidecar binary | Sidecar is resolved only next to the app executable (bundled `externalBin`), never from `PATH`. | `transcription/sidecar.rs` `sidecar_path` |
| **Spoofing** | Tampered or replaced model | Files whose SHA-256 differs from the compiled-in catalog are refused (`model_hash_mismatch`). | `asr/src/verify.rs`, `transcription-models.json` |
| **Tampering** | Edited archive segment | GCM authentication fails; the segment is skipped, never decoded. | `transcription/crypto.rs`, `recording.rs` `finalize` |
| **Tampering** | Malicious model archive (traversal, bombs) | Whitelisted file names, size limits, no `..` or `/`, atomic replace. | `transcription/models.rs` `install_from_archive` |
| **Tampering** | Crafted `asset_id` reaching the filesystem | `valid_id`: 1–128 chars of `[A-Za-z0-9_-]`, checked before any path is built. | `recording.rs` `valid_id` |
| **Repudiation** | n/a | Single-user desktop app; logs record events and counts, not content. | — |
| **Information disclosure** | Plaintext audio on disk | Segments are encrypted before writing (`.partial` → fsync → rename). The final pass decrypts in memory only. | `archive.rs`, `recording.rs` |
| **Information disclosure** | Transcript text or paths in logs/errors | Sidecar and commands return short error codes only. | `asr/src/main.rs`, `NativeLiveRecorder.tsx` |
| **Information disclosure** | Recording without the user knowing | Consent gate before the first recording; level meter and timer while recording. | `NativeLiveRecorder.tsx` |
| **Denial of service** | Oversized frames, hung sidecar | Frame caps, 180 s inactivity watchdog, bounded live queue that falls back to record-only and never drops archive audio. | `sidecar.rs`, `asr/src/protocol.rs`, `recording.rs` |
| **Denial of service** | Slow machine starves capture | Tier benchmark puts below-floor machines in record-only mode. | `transcription/tier.rs` |
| **Elevation of privilege** | ffmpeg fallback reading other files or the network | Run without a shell, explicit args, `-protocol_whitelist file`, absolute input only, output created exclusively by the caller. | `sidecar.rs` `ffmpeg_to_wav` |

## Supply chain

- Pinned exactly, `Cargo.lock` committed: `sherpa-onnx =2.0.1`, `cpal =0.18.2`, `aes-gcm =0.10.3`,
  `symphonia =0.6.1`, `sysinfo =0.40.1`, `starship-battery =0.12.0`, `tauri-plugin-http =2.8.3`.
- Models: pinned GitHub release URLs; size and SHA-256 checked before extraction.
- CI: actions pinned by commit SHA in `transcription-models.yml`; gitleaks secret scan pinned.
- Licenses: `THIRD_PARTY_NOTICES.md`, NVIDIA Open Model License text in `docs/licenses/`.

## Known limits

- The recording key is in the OS keychain, readable by anyone logged in as the same user. This
  protects against stolen disks and other accounts, not malware running as the user.
- The ffmpeg fallback uses whatever `ffmpeg` is first on `PATH`; it is trusted like any user tool.
- Transcripts follow the existing session store and are not encrypted separately.
- macOS and Windows loopback capture are compiled in CI but not yet tested on real hardware.
- Custom vocabulary (hotwords) is not offered: sherpa-onnx 2.0.1 needs a `bpe.vocab` for it
  (`sherpa-onnx/csrc/utils.cc:104`, `online-recognizer-transducer-impl.h:110` at tag v2.0.1),
  and the pinned model archives ship none.
- Live text is English only (Nemotron EN). The final pass (Parakeet v3) detects and transcribes
  25 European languages, so non-English lectures still get a full transcript after stopping.
