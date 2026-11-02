//! Tauri commands for on-device transcription. The file to transcribe is chosen in a native dialog
//! opened from Rust, so the webview never supplies a filesystem path. Events and errors carry only
//! short codes and numbers: no transcript text or file paths reach logs.

use super::catalog::{self, catalog, PARAKEET_ID, VAD_ID};
use super::models::{self, ModelError};
use super::recording::{self, RecordingState, Source};
use super::sidecar;
use serde::Serialize;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, Runtime, State};
use tauri_plugin_dialog::DialogExt;

/// Models needed for file transcription.
const REQUIRED_MODELS: [&str; 2] = [PARAKEET_ID, VAD_ID];
const KNOWN_ROLES: [&str; 3] = ["final", "vad", "live"];
const MEDIA_EXTENSIONS: [&str; 13] = ["wav", "mp3", "m4a", "mp4", "aac", "flac", "ogg", "oga", "webm", "mkv", "mov", "opus", "caf"];

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelStatus {
    id: String,
    role: String,
    installed: bool,
    download_bytes: u64,
    license: String,
    attribution: String,
}

fn models_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    app.path().app_data_dir().map(|dir| dir.join("models")).map_err(|_| "no_app_data_dir".to_string())
}

#[tauri::command]
pub fn transcription_models_status<R: Runtime>(app: AppHandle<R>) -> Result<Vec<ModelStatus>, String> {
    let dir = models_dir(&app)?;
    Ok(catalog()
        .models
        .iter()
        .map(|(id, entry)| ModelStatus {
            id: id.to_string(),
            role: entry.role.clone(),
            installed: models::is_installed(&dir, id, entry),
            download_bytes: entry.archive_bytes,
            license: entry.license.clone(),
            attribution: entry.attribution.clone(),
        })
        .collect())
}

/// Downloads and installs every missing model with one of `roles`, reporting byte progress.
#[tauri::command]
pub async fn transcription_install_models<R: Runtime>(
    app: AppHandle<R>,
    roles: Vec<String>,
    on_event: Channel<Value>,
) -> Result<(), String> {
    if roles.is_empty() || roles.iter().any(|role| !KNOWN_ROLES.contains(&role.as_str())) {
        return Err("invalid_roles".into());
    }
    let dir = models_dir(&app)?;
    for (id, entry) in catalog().models.iter().filter(|(_, entry)| roles.contains(&entry.role)) {
        let id = id.as_str();
        if models::is_installed(&dir, id, entry) {
            continue;
        }
        let mut last_sent = 0u64;
        models::download_and_install(&dir, id, entry, |done, total| {
            // Throttle to ~1 MB steps so the channel isn't flooded.
            if done - last_sent >= 1 << 20 || done == total {
                last_sent = done;
                let _ = on_event.send(json!({ "type": "download", "id": id, "done": done, "total": total }));
            }
        })
        .await
        .map_err(|err: ModelError| err.code())?;
        let _ = on_event.send(json!({ "type": "installed", "id": id }));
    }
    Ok(())
}

fn pinned(dir: &Path, id: &str, key: &str) -> Result<Value, String> {
    let entry = catalog::model(id).ok_or("unknown_model")?;
    let file = entry.files.get(key).ok_or("unknown_model_file")?;
    Ok(json!({ "path": models::file_path(dir, id, &file.name), "sha256": file.sha256 }))
}

fn transcribe_request(dir: &Path, audio: &Path, language: &str) -> Result<Value, String> {
    Ok(json!({
        "type": "transcribeFile",
        "id": "file",
        "audioPath": audio,
        "language": language,
        "modelVersion": format!("{PARAKEET_ID}@sherpa-onnx-{}", catalog().sherpa_onnx_version),
        "model": {
            "encoder": pinned(dir, PARAKEET_ID, "encoder")?,
            "decoder": pinned(dir, PARAKEET_ID, "decoder")?,
            "joiner": pinned(dir, PARAKEET_ID, "joiner")?,
            "tokens": pinned(dir, PARAKEET_ID, "tokens")?,
        },
        "vad": pinned(dir, VAD_ID, "model")?,
        "numThreads": std::thread::available_parallelism().map(|n| n.get().clamp(1, 4) as i32).unwrap_or(2),
    }))
}

/// Opens a native file picker and transcribes the chosen recording on-device.
/// Returns `None` if the user cancels; otherwise the Transcript JSON (validated again in the UI).
#[tauri::command]
pub async fn transcription_pick_and_transcribe<R: Runtime>(
    app: AppHandle<R>,
    language: String,
    on_event: Channel<Value>,
) -> Result<Option<Value>, String> {
    let dir = models_dir(&app)?;
    for id in REQUIRED_MODELS {
        let entry = catalog::model(id).ok_or("unknown_model")?;
        if !models::is_installed(&dir, id, entry) {
            return Err("models_missing".into());
        }
    }
    let language = if language.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') && language.len() <= 16 {
        language
    } else {
        "auto".to_string()
    };

    let dialog_app = app.clone();
    let picked = tauri::async_runtime::spawn_blocking(move || {
        dialog_app.dialog().file().add_filter("Audio or video", &MEDIA_EXTENSIONS).blocking_pick_file()
    })
    .await
    .map_err(|_| "dialog_failed")?;
    let Some(picked) = picked else { return Ok(None) };
    let audio = picked.into_path().map_err(|_| "unsupported_path")?;

    let cache_dir = app.path().app_cache_dir().map_err(|_| "no_app_cache_dir")?;
    let transcript = tauri::async_runtime::spawn_blocking(move || -> Result<Value, String> {
        let forward = |event: &Value| {
            let _ = on_event.send(event.clone());
        };
        let request = transcribe_request(&dir, &audio, &language)?;
        match sidecar::run(&request, forward) {
            Err(code) if code == "audio_unsupported" || code == "audio_corrupt" => {
                // symphonia has no Opus decoder (e.g. WebM recordings): fall back to system ffmpeg.
                let ffmpeg = sidecar::find_ffmpeg().ok_or_else(|| "audio_unsupported_no_ffmpeg".to_string())?;
                let _ = on_event.send(json!({ "type": "status", "stage": "converting" }));
                std::fs::create_dir_all(&cache_dir).map_err(|_| "io_error")?;
                // Unpredictable name, created exclusively: a pre-planted file or link makes this fail.
                let nonce = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|elapsed| elapsed.as_nanos())
                    .unwrap_or_default();
                let wav = cache_dir.join(format!("import-{}-{nonce:x}.wav", std::process::id()));
                std::fs::OpenOptions::new().write(true).create_new(true).open(&wav).map_err(|_| "io_error")?;
                let converted = sidecar::ffmpeg_to_wav(&ffmpeg, &audio, &wav)
                    .and_then(|()| sidecar::run(&transcribe_request(&dir, &wav, &language)?, forward));
                let _ = std::fs::remove_file(&wav);
                converted
            }
            other => other,
        }
    })
    .await
    .map_err(|_| "worker_failed")??;
    Ok(Some(transcript))
}

fn app_data<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|_| "no_app_data_dir".to_string())
}

/// Starts native capture into the encrypted archive, with live recognition when models are present.
#[tauri::command]
pub fn recording_start<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, RecordingState>,
    session_id: String,
    asset_id: String,
    source: String,
    on_event: Channel<Value>,
) -> Result<(), String> {
    let source = match source.as_str() {
        "mic" => Source::Mic,
        "system" => Source::System,
        _ => return Err("invalid_source".into()),
    };
    let mut active = state.0.lock().map_err(|_| "state_poisoned")?;
    if active.is_some() {
        return Err("already_recording".into());
    }
    *active = Some(recording::start(&app_data(&app)?, session_id, asset_id, source, on_event)?);
    Ok(())
}

/// Stops capture; resolves once the archive is closed and the live pass has flushed.
#[tauri::command]
pub async fn recording_stop(state: State<'_, RecordingState>) -> Result<(), String> {
    let active = state.0.lock().map_err(|_| "state_poisoned")?.take();
    if let Some(active) = active {
        tauri::async_runtime::spawn_blocking(move || active.stop()).await.map_err(|_| "worker_failed")?;
    }
    Ok(())
}

/// Lets a reloaded webview find a recording that is still running.
#[tauri::command]
pub fn recording_status(state: State<'_, RecordingState>) -> Result<Value, String> {
    let active = state.0.lock().map_err(|_| "state_poisoned")?;
    Ok(match active.as_ref() {
        Some(rec) => json!({
            "active": true,
            "sessionId": rec.session_id,
            "assetId": rec.asset_id,
            "source": if rec.source == Source::System { "system" } else { "mic" },
            "startedAtMs": rec.started_at_ms,
            "recordOnly": rec.record_only.load(std::sync::atomic::Ordering::SeqCst),
        }),
        None => json!({ "active": false }),
    })
}

/// Re-routes a running recording's events to a new channel (after a webview reload).
#[tauri::command]
pub fn recording_attach(state: State<'_, RecordingState>, on_event: Channel<Value>) -> Result<bool, String> {
    let active = state.0.lock().map_err(|_| "state_poisoned")?;
    match active.as_ref() {
        Some(rec) => {
            *rec.events.lock().map_err(|_| "state_poisoned")? = Some(on_event);
            Ok(true)
        }
        None => Ok(false),
    }
}

/// Final pass over a recording's encrypted archive (after stop, or to recover a crashed or
/// record-only session). Returns the Transcript JSON, validated again in the UI.
#[tauri::command]
pub async fn recording_finalize<R: Runtime>(app: AppHandle<R>, asset_id: String, on_event: Channel<Value>) -> Result<Value, String> {
    let app_data = app_data(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let key = crate::transcription::crypto::RecordingKey::load_or_create().map_err(|_| "keychain_unavailable")?;
        recording::finalize(&app_data, &asset_id, key, |event| {
            let _ = on_event.send(event.clone());
        })
    })
    .await
    .map_err(|_| "worker_failed")?
}

/// Performance tier for on-device transcription. Runs a one-time ~10 s benchmark when the live
/// model is installed and nothing is cached; `null` until then.
#[tauri::command]
pub async fn transcription_tier<R: Runtime>(app: AppHandle<R>) -> Result<Option<Value>, String> {
    let app_data = app_data(&app)?;
    tauri::async_runtime::spawn_blocking(move || super::tier::load_or_measure(&app_data))
        .await
        .map_err(|_| "worker_failed")?
}
