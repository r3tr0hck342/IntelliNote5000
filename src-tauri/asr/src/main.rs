//! IntelliNote ASR sidecar. Spawned by the app; speaks only framed JSON over stdin/stdout
//! (see protocol.rs). It opens no sockets and never writes transcript text or file paths to stderr.

mod decode;
mod protocol;
mod stream;
mod transcribe;
mod verify;

use decode::{decode_archive_bytes, decode_to_16k_mono, DecodeError};
use protocol::{read_frame, write_json, KIND_ARCHIVE, KIND_JSON, KIND_PCM};
use stream::{benchmark, pcm_from_bytes, LiveEvent, LiveSession};
use serde::Deserialize;
use serde_json::json;
use std::cell::Cell;
use std::io::{self, BufReader, BufWriter, Stdout, Write};
use std::path::Path;
use transcribe::{create_parakeet, create_vad, AsrError, FileTranscriber, TransducerModel};
use verify::PinnedFile;

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", deny_unknown_fields)]
enum Request {
    Hello,
    #[serde(rename_all = "camelCase")]
    TranscribeFile {
        id: String,
        audio_path: String,
        model: TransducerModel,
        vad: PinnedFile,
        model_version: String,
        language: String,
        #[serde(default)]
        num_threads: Option<i32>,
    },
    #[serde(rename_all = "camelCase")]
    StartStream {
        model: TransducerModel,
        vad: PinnedFile,
        model_version: String,
        #[serde(default)]
        num_threads: Option<i32>,
    },
    StopStream,
    /// Final pass over the recording archive: WAV segments follow as kind-3 frames.
    #[serde(rename_all = "camelCase")]
    StartFinal {
        id: String,
        model: TransducerModel,
        vad: PinnedFile,
        model_version: String,
        language: String,
        #[serde(default)]
        num_threads: Option<i32>,
    },
    EndFinal,
    #[serde(rename_all = "camelCase")]
    Benchmark {
        model: TransducerModel,
        #[serde(default)]
        num_threads: Option<i32>,
    },
    Shutdown,
}

struct FileJob<'a> {
    id: &'a str,
    audio_path: &'a str,
    model: &'a TransducerModel,
    vad: &'a PinnedFile,
    model_version: &'a str,
    language: &'a str,
    num_threads: i32,
}

fn asr_error_code(err: &AsrError) -> &'static str {
    match err {
        AsrError::ModelHashMismatch => "model_hash_mismatch",
        AsrError::ModelUnreadable => "model_unreadable",
        AsrError::ModelLoadFailed => "model_load_failed",
    }
}

fn decode_error_code(err: &DecodeError) -> &'static str {
    match err {
        DecodeError::Unreadable => "audio_unreadable",
        DecodeError::Unsupported => "audio_unsupported",
        DecodeError::Corrupt => "audio_corrupt",
    }
}

fn send(out: &mut BufWriter<Stdout>, value: serde_json::Value) {
    // If the app is gone there is nobody to report to; exit instead of spinning.
    if write_json(out, &value).is_err() {
        std::process::exit(0);
    }
}

fn error(out: &mut BufWriter<Stdout>, id: &str, code: &str) {
    send(out, json!({ "type": "error", "id": id, "code": code }));
}

fn send_live_events(out: &mut BufWriter<Stdout>, model_version: &str, events: Vec<LiveEvent>) {
    for event in events {
        match event {
            LiveEvent::Partial(text) => send(out, json!({ "type": "partial", "text": text })),
            LiveEvent::Final(segment) => {
                send(out, json!({ "type": "final", "segment": segment, "modelVersion": model_version }))
            }
        }
    }
}

fn transcribe_file(out: &mut BufWriter<Stdout>, job: FileJob) {
    let recognizer = match create_parakeet(job.model, job.num_threads) {
        Ok(recognizer) => recognizer,
        Err(err) => return error(out, job.id, asr_error_code(&err)),
    };
    let vad = match create_vad(job.vad) {
        Ok(vad) => vad,
        Err(err) => return error(out, job.id, asr_error_code(&err)),
    };
    send(out, json!({ "type": "status", "id": job.id, "stage": "transcribing" }));

    let mut transcriber = FileTranscriber::new(recognizer, vad);
    let mut processed_samples: u64 = 0;
    let duration_sec: Cell<Option<f64>> = Cell::new(None);
    let mut last_report = 0.0f64;
    let decoded = decode_to_16k_mono(
        Path::new(job.audio_path),
        |chunk| {
            processed_samples += chunk.len() as u64;
            transcriber.accept(chunk);
            let processed_sec = processed_samples as f64 / decode::TARGET_SAMPLE_RATE as f64;
            if processed_sec - last_report >= 5.0 {
                last_report = processed_sec;
                send(out, json!({ "type": "progress", "id": job.id, "processedSec": processed_sec, "durationSec": duration_sec.get() }));
            }
        },
        |info| duration_sec.set(info.duration_sec),
    );
    if let Err(err) = decoded {
        return error(out, job.id, decode_error_code(&err));
    }
    let segments = transcriber.finish();
    send(
        out,
        json!({
            "type": "result",
            "id": job.id,
            "transcript": {
                "engine": "sherpa-onnx",
                "modelVersion": job.model_version,
                "language": job.language,
                "segments": segments,
            },
        }),
    );
}

fn main() {
    let mut input = BufReader::new(io::stdin().lock());
    let mut out = BufWriter::new(io::stdout());
    let mut live: Option<(LiveSession, String)> = None;
    // (id, transcriber, model version, language, decoded samples)
    let mut final_pass: Option<(String, FileTranscriber, String, String, u64)> = None;
    loop {
        let frame = match read_frame(&mut input) {
            Ok(Some(frame)) => frame,
            Ok(None) => break, // app closed stdin
            Err(_) => {
                error(&mut out, "", "protocol_error");
                break;
            }
        };
        if frame.kind == KIND_PCM {
            match (live.as_mut(), pcm_from_bytes(&frame.payload)) {
                (Some((session, version)), Some(samples)) => {
                    let events = session.accept(&samples);
                    let version = version.clone();
                    send_live_events(&mut out, &version, events);
                }
                (None, _) => error(&mut out, "live", "no_active_stream"),
                (_, None) => error(&mut out, "live", "bad_pcm_frame"),
            }
            continue;
        }
        if frame.kind == KIND_ARCHIVE {
            let Some((id, transcriber, _, _, processed)) = final_pass.as_mut() else {
                error(&mut out, "final", "no_active_final");
                continue;
            };
            let id = id.clone();
            if decode_archive_bytes(frame.payload, |chunk| {
                *processed += chunk.len() as u64;
                transcriber.accept(chunk);
            })
            .is_err()
            {
                // A corrupt segment is skipped; the rest of the lecture is still transcribed.
                send(&mut out, json!({ "type": "segmentSkipped", "id": id }));
            }
            let processed_sec = *processed as f64 / decode::TARGET_SAMPLE_RATE as f64;
            send(&mut out, json!({ "type": "progress", "id": id, "processedSec": processed_sec }));
            continue;
        }
        if frame.kind != KIND_JSON {
            error(&mut out, "", "unsupported_frame");
            continue;
        }
        let request: Request = match serde_json::from_slice(&frame.payload) {
            Ok(request) => request,
            Err(_) => {
                error(&mut out, "", "invalid_request");
                continue;
            }
        };
        match request {
            Request::Hello => send(
                &mut out,
                json!({ "type": "hello", "sidecarVersion": env!("CARGO_PKG_VERSION"), "sherpaOnnxVersion": sherpa_onnx::version() }),
            ),
            Request::TranscribeFile { id, audio_path, model, vad, model_version, language, num_threads } => {
                transcribe_file(
                    &mut out,
                    FileJob {
                        id: &id,
                        audio_path: &audio_path,
                        model: &model,
                        vad: &vad,
                        model_version: &model_version,
                        language: &language,
                        num_threads: num_threads.unwrap_or(2),
                    },
                );
            }
            Request::StartStream { model, vad, model_version, num_threads } => {
                match LiveSession::new(&model, &vad, num_threads.unwrap_or(2)) {
                    Ok(session) => {
                        live = Some((session, model_version));
                        send(&mut out, json!({ "type": "streamStarted" }));
                    }
                    Err(err) => error(&mut out, "live", asr_error_code(&err)),
                }
            }
            Request::StopStream => {
                if let Some((mut session, version)) = live.take() {
                    let events = session.finish();
                    send_live_events(&mut out, &version, events);
                }
                send(&mut out, json!({ "type": "streamStopped" }));
            }
            Request::StartFinal { id, model, vad, model_version, language, num_threads } => {
                let built = create_parakeet(&model, num_threads.unwrap_or(2))
                    .and_then(|recognizer| create_vad(&vad).map(|vad| FileTranscriber::new(recognizer, vad)));
                match built {
                    Ok(transcriber) => {
                        send(&mut out, json!({ "type": "status", "id": id, "stage": "transcribing" }));
                        final_pass = Some((id, transcriber, model_version, language, 0));
                    }
                    Err(err) => error(&mut out, &id, asr_error_code(&err)),
                }
            }
            Request::EndFinal => match final_pass.take() {
                Some((id, transcriber, model_version, language, _)) => send(
                    &mut out,
                    json!({
                        "type": "result",
                        "id": id,
                        "transcript": {
                            "engine": "sherpa-onnx",
                            "modelVersion": model_version,
                            "language": language,
                            "segments": transcriber.finish(),
                        },
                    }),
                ),
                None => error(&mut out, "final", "no_active_final"),
            },
            Request::Benchmark { model, num_threads } => match benchmark(&model, num_threads.unwrap_or(2), 10) {
                Ok(rtf) => send(&mut out, json!({ "type": "result", "id": "benchmark", "transcript": { "rtf": rtf, "audioSec": 10 } })),
                Err(err) => error(&mut out, "benchmark", asr_error_code(&err)),
            },
            Request::Shutdown => break,
        }
    }
    let _ = out.flush();
}
