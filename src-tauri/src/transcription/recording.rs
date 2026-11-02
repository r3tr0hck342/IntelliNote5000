//! Native lecture recording: capture → archive (always) → live recognizer (when it keeps up).
//!
//! Capture callbacks only forward samples to a worker thread, so they never block. The worker
//! writes the encrypted archive first, then offers audio to a bounded queue feeding the sidecar.
//! If that queue fills (CPU can't keep up) or the sidecar dies, the session switches to
//! record-only: audio is still archived and the final pass transcribes it later. Audio is never
//! dropped. The recording lives in the backend, so it survives a webview reload.

use super::archive::{ArchiveWriter, SAMPLE_RATE};
use super::catalog::{self, catalog, PARAKEET_ID, VAD_ID};
use super::crypto::RecordingKey;
use super::{models, sidecar};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{FromSample, SampleFormat, SizedSample};
use serde_json::{json, Value};
use std::io::{BufReader, BufWriter, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, Sender, SyncSender, TrySendError};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::ipc::Channel;

pub const LIVE_ID: &str = "nemotron-speech-streaming-en-0.6b-560ms-int8";
/// ~6 s of 100 ms chunks: beyond this the recognizer is falling behind.
const ASR_QUEUE_CHUNKS: usize = 60;
const LEVEL_EVERY: Duration = Duration::from_millis(100);

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Source {
    Mic,
    System,
}

pub type EventSink = Arc<Mutex<Option<Channel<Value>>>>;

fn emit(sink: &EventSink, event: Value) {
    if let Some(channel) = sink.lock().unwrap().as_ref() {
        let _ = channel.send(event);
    }
}

pub struct ActiveRecording {
    pub session_id: String,
    pub asset_id: String,
    pub source: Source,
    pub started_at_ms: u64,
    pub record_only: Arc<AtomicBool>,
    pub events: EventSink,
    stop: Arc<AtomicBool>,
    worker: Option<JoinHandle<()>>,
    stream: cpal::Stream,
}

// cpal::Stream is !Send on some platforms; it is only touched behind the state Mutex.
unsafe impl Send for ActiveRecording {}

#[derive(Default)]
pub struct RecordingState(pub Mutex<Option<ActiveRecording>>);

/// Resamples mono audio to 16 kHz: a windowed-sinc low-pass FIR (Blackman, cutoff 7 kHz, below the
/// 8 kHz output Nyquist) removes content that would alias, then output samples are interpolated
/// linearly from the filtered signal. State carries across chunks, so chunk boundaries are seamless.
pub struct Resampler {
    ratio: f64,
    taps: Vec<f32>,
    /// Unfiltered input history needed by the FIR (taps - 1 samples).
    history: Vec<f32>,
    /// Filtered samples not yet consumed by interpolation.
    filtered: Vec<f32>,
    position: f64,
}

const FIR_TAPS: usize = 63;
const CUTOFF_HZ: f64 = 7_000.0;

fn lowpass_taps(input_rate: f64) -> Vec<f32> {
    let fc = CUTOFF_HZ / input_rate; // normalized cutoff (cycles/sample)
    let mid = (FIR_TAPS - 1) as f64 / 2.0;
    let mut taps: Vec<f64> = (0..FIR_TAPS)
        .map(|n| {
            let x = n as f64 - mid;
            let sinc = if x == 0.0 { 2.0 * fc } else { (2.0 * std::f64::consts::PI * fc * x).sin() / (std::f64::consts::PI * x) };
            let w = 2.0 * std::f64::consts::PI * n as f64 / (FIR_TAPS - 1) as f64;
            sinc * (0.42 - 0.5 * w.cos() + 0.08 * (2.0 * w).cos())
        })
        .collect();
    let sum: f64 = taps.iter().sum();
    taps.iter_mut().for_each(|t| *t /= sum); // unity gain at DC
    taps.into_iter().map(|t| t as f32).collect()
}

impl Resampler {
    pub fn new(input_rate: u32) -> Self {
        let ratio = input_rate as f64 / SAMPLE_RATE as f64;
        Self { ratio, taps: lowpass_taps(input_rate as f64), history: vec![0.0; FIR_TAPS - 1], filtered: Vec::new(), position: 0.0 }
    }

    pub fn process(&mut self, mono: &[f32]) -> Vec<f32> {
        if (self.ratio - 1.0).abs() < f64::EPSILON {
            return mono.to_vec();
        }
        self.history.extend_from_slice(mono);
        for window in self.history.windows(FIR_TAPS) {
            self.filtered.push(window.iter().zip(&self.taps).map(|(x, t)| x * t).sum());
        }
        let keep = self.history.len() - (FIR_TAPS - 1);
        self.history.drain(..keep);

        let mut out = Vec::with_capacity((self.filtered.len() as f64 / self.ratio) as usize + 1);
        while self.position + 1.0 < self.filtered.len() as f64 {
            let index = self.position as usize;
            let frac = (self.position - index as f64) as f32;
            out.push(self.filtered[index] * (1.0 - frac) + self.filtered[index + 1] * frac);
            self.position += self.ratio;
        }
        let consumed = (self.position as usize).min(self.filtered.len());
        self.filtered.drain(..consumed);
        self.position -= consumed as f64;
        out
    }
}

pub fn to_mono(interleaved: &[f32], channels: usize) -> Vec<f32> {
    interleaved.chunks(channels.max(1)).map(|frame| frame.iter().sum::<f32>() / frame.len() as f32).collect()
}

fn pick_device(source: Source) -> Result<cpal::Device, String> {
    match source {
        Source::Mic => cpal::default_host().default_input_device().ok_or_else(|| "no_microphone".into()),
        Source::System => system_audio_device(),
    }
}

#[cfg(target_os = "linux")]
fn system_audio_device() -> Result<cpal::Device, String> {
    // PulseAudio (and PipeWire's Pulse server) expose playback as "Monitor of …" input sources.
    let host = cpal::host_from_id(cpal::HostId::PulseAudio).map_err(|_| "system_audio_unavailable")?;
    host.input_devices()
        .map_err(|_| "system_audio_unavailable")?
        .find(|device| device.description().map(|d| d.name().starts_with("Monitor of")).unwrap_or(false))
        .ok_or_else(|| "system_audio_unavailable".into())
}

#[cfg(not(target_os = "linux"))]
fn system_audio_device() -> Result<cpal::Device, String> {
    // WASAPI (Windows) and Core Audio on macOS 14.6+ record an output device's mix when it is
    // opened as an input (cpal: host/wasapi/mod.rs, host/coreaudio/macos/device.rs).
    cpal::default_host().default_output_device().ok_or_else(|| "system_audio_unavailable".into())
}

fn build_stream<T>(device: &cpal::Device, config: cpal::StreamConfig, sender: Sender<Vec<f32>>) -> Result<cpal::Stream, String>
where
    T: SizedSample,
    f32: FromSample<T>,
{
    device
        .build_input_stream::<T, _, _>(
            config,
            move |data: &[T], _| {
                let _ = sender.send(data.iter().map(|s| s.to_sample::<f32>()).collect());
            },
            |_| {},
            None,
        )
        .map_err(|_| "capture_failed".to_string())
}

struct AsrLink {
    child: Child,
    frames: SyncSender<Vec<f32>>,
}

/// Starts the live sidecar. Returns `None` (record-only) if models are missing or it won't start.
fn start_asr(models_dir: &Path, events: &EventSink, record_only: &Arc<AtomicBool>) -> Option<AsrLink> {
    let pinned = |id: &str, key: &str| -> Option<Value> {
        let file = catalog::model(id)?.files.get(key)?;
        Some(json!({ "path": models::file_path(models_dir, id, &file.name), "sha256": file.sha256 }))
    };
    for id in [LIVE_ID, VAD_ID] {
        if !models::is_installed(models_dir, id, catalog::model(id)?) {
            return None;
        }
    }
    let request = json!({
        "type": "startStream",
        "modelVersion": format!("{LIVE_ID}@sherpa-onnx-{}", catalog().sherpa_onnx_version),
        "model": { "encoder": pinned(LIVE_ID, "encoder")?, "decoder": pinned(LIVE_ID, "decoder")?,
                   "joiner": pinned(LIVE_ID, "joiner")?, "tokens": pinned(LIVE_ID, "tokens")? },
        "vad": pinned(VAD_ID, "model")?,
        "numThreads": std::thread::available_parallelism().map(|n| n.get().clamp(1, 4) as i32).unwrap_or(2),
    });
    let mut child = Command::new(sidecar::sidecar_path().ok()?)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let mut stdin = BufWriter::new(child.stdin.take()?);
    sidecar::write_frame(&mut stdin, &request).ok()?;

    // Writer thread: PCM frames out. A closed pipe (sidecar died) flips the session to record-only.
    let (frames, queue) = mpsc::sync_channel::<Vec<f32>>(ASR_QUEUE_CHUNKS);
    let writer_flag = record_only.clone();
    std::thread::spawn(move || {
        for samples in queue {
            let mut payload = Vec::with_capacity(samples.len() * 4 + 5);
            payload.extend_from_slice(&((samples.len() * 4 + 1) as u32).to_le_bytes());
            payload.push(2);
            samples.iter().for_each(|s| payload.extend_from_slice(&s.to_le_bytes()));
            if stdin.write_all(&payload).and_then(|_| stdin.flush()).is_err() {
                writer_flag.store(true, Ordering::SeqCst);
                return;
            }
        }
        let _ = sidecar::write_frame(&mut stdin, &json!({ "type": "stopStream" }));
    });

    // Reader thread: partial/final events in.
    let mut stdout = BufReader::new(child.stdout.take()?);
    let reader_events = events.clone();
    let reader_flag = record_only.clone();
    std::thread::spawn(move || loop {
        match sidecar::read_frame(&mut stdout) {
            Ok(Some(message)) => match message["type"].as_str() {
                Some("partial") | Some("final") => emit(&reader_events, message),
                Some("error") => {
                    reader_flag.store(true, Ordering::SeqCst);
                    emit(&reader_events, json!({ "type": "recordOnly", "reason": message["code"] }));
                }
                Some("streamStopped") => return,
                _ => {}
            },
            _ => {
                if !reader_flag.swap(true, Ordering::SeqCst) {
                    emit(&reader_events, json!({ "type": "recordOnly", "reason": "recognizer_stopped" }));
                }
                return;
            }
        }
    });
    Some(AsrLink { child, frames })
}

struct WorkerContext {
    channels: usize,
    input_rate: u32,
    archive: ArchiveWriter,
    asr: Option<AsrLink>,
    stop: Arc<AtomicBool>,
    record_only: Arc<AtomicBool>,
    events: EventSink,
}

fn worker(receiver: Receiver<Vec<f32>>, mut ctx: WorkerContext) {
    let mut resampler = Resampler::new(ctx.input_rate);
    let mut level_sum = 0.0f32;
    let mut level_count = 0usize;
    let mut last_level = Instant::now();
    while !ctx.stop.load(Ordering::SeqCst) {
        let Ok(chunk) = receiver.recv_timeout(Duration::from_millis(200)) else { continue };
        let samples = resampler.process(&to_mono(&chunk, ctx.channels));
        if samples.is_empty() {
            continue;
        }
        // 1. Archive first: this is the copy that must never be lost.
        if ctx.archive.push(&samples).is_err() {
            emit(&ctx.events, json!({ "type": "error", "code": "archive_write_failed" }));
            break;
        }
        // 2. Live recognition, only while it keeps up.
        if !ctx.record_only.load(Ordering::SeqCst) {
            if let Some(link) = ctx.asr.as_ref() {
                let reason = match link.frames.try_send(samples.clone()) {
                    Ok(()) => None,
                    Err(TrySendError::Full(_)) => Some("falling_behind"),
                    Err(TrySendError::Disconnected(_)) => Some("recognizer_stopped"),
                };
                if let Some(reason) = reason {
                    ctx.record_only.store(true, Ordering::SeqCst);
                    emit(&ctx.events, json!({ "type": "recordOnly", "reason": reason }));
                }
            }
        }
        level_sum += samples.iter().map(|s| s * s).sum::<f32>();
        level_count += samples.len();
        if last_level.elapsed() >= LEVEL_EVERY {
            let rms = (level_sum / level_count.max(1) as f32).sqrt();
            let seconds = ctx.archive.total_samples() as f64 / SAMPLE_RATE as f64;
            emit(&ctx.events, json!({ "type": "level", "rms": rms, "seconds": seconds }));
            level_sum = 0.0;
            level_count = 0;
            last_level = Instant::now();
        }
    }
    // Drain what the capture callback already queued, then close the archive cleanly.
    for chunk in receiver.try_iter() {
        let _ = ctx.archive.push(&resampler.process(&to_mono(&chunk, ctx.channels)));
    }
    let manifest = ctx.archive.finish();
    if let Some(mut link) = ctx.asr.take() {
        drop(link.frames); // the writer sends stopStream once the queue drains
        let deadline = Instant::now() + Duration::from_secs(10);
        while Instant::now() < deadline && !matches!(link.child.try_wait(), Ok(Some(_))) {
            std::thread::sleep(Duration::from_millis(50));
        }
        let _ = link.child.kill();
        let _ = link.child.wait();
    }
    match manifest {
        Ok(manifest) => emit(&ctx.events, json!({
            "type": "stopped",
            "durationSec": manifest.total_samples as f64 / SAMPLE_RATE as f64,
            "segments": manifest.segments.len(),
        })),
        Err(_) => emit(&ctx.events, json!({ "type": "error", "code": "archive_write_failed" })),
    }
}

pub fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 128 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

pub fn recordings_dir(app_data: &Path, asset_id: &str) -> PathBuf {
    app_data.join("recordings").join(asset_id)
}

pub fn start(
    app_data: &Path,
    session_id: String,
    asset_id: String,
    source: Source,
    channel: Channel<Value>,
) -> Result<ActiveRecording, String> {
    if !valid_id(&asset_id) || !valid_id(&session_id) {
        return Err("invalid_id".into());
    }
    let key = RecordingKey::load_or_create().map_err(|_| "keychain_unavailable")?;
    let archive = ArchiveWriter::create(&recordings_dir(app_data, &asset_id), key).map_err(|_| "archive_unavailable")?;
    let device = pick_device(source)?;
    let supported = device.default_input_config().map_err(|_| "capture_failed")?;
    let config: cpal::StreamConfig = supported.config();
    let channels = config.channels as usize;
    let input_rate = config.sample_rate;

    let events: EventSink = Arc::new(Mutex::new(Some(channel)));
    let record_only = Arc::new(AtomicBool::new(false));
    // Below-floor machines record only: steady audio beats lagging live text, and the final
    // pass still produces the transcript after stopping.
    let below_floor = super::tier::cached_tier(app_data) == Some(super::tier::Tier::BelowFloor);
    let asr = if below_floor { None } else { start_asr(&app_data.join("models"), &events, &record_only) };
    if asr.is_none() {
        record_only.store(true, Ordering::SeqCst);
        let reason = if below_floor { "below_floor" } else { "models_missing" };
        emit(&events, json!({ "type": "recordOnly", "reason": reason }));
    }

    let (sender, receiver) = mpsc::channel();
    let stream = match supported.sample_format() {
        SampleFormat::F32 => build_stream::<f32>(&device, config, sender),
        SampleFormat::I16 => build_stream::<i16>(&device, config, sender),
        SampleFormat::I32 => build_stream::<i32>(&device, config, sender),
        SampleFormat::U16 => build_stream::<u16>(&device, config, sender),
        _ => Err("unsupported_sample_format".into()),
    }?;
    stream.play().map_err(|_| "capture_failed")?;

    let stop = Arc::new(AtomicBool::new(false));
    let ctx = WorkerContext {
        channels,
        input_rate,
        archive,
        asr,
        stop: stop.clone(),
        record_only: record_only.clone(),
        events: events.clone(),
    };
    let worker = std::thread::spawn(move || worker(receiver, ctx));
    let started_at_ms = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0);
    Ok(ActiveRecording { session_id, asset_id, source, started_at_ms, record_only, events, stop, worker: Some(worker), stream })
}

impl ActiveRecording {
    /// Stops capture and waits for the archive to close and the live pass to flush.
    pub fn stop(mut self) {
        let _ = self.stream.pause();
        self.stop.store(true, Ordering::SeqCst);
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

/// Final pass: decrypts each archive segment in memory and streams it to a fresh sidecar running
/// Parakeet. Decrypted audio never touches disk. Works for complete and crash-interrupted archives.
pub fn finalize(app_data: &Path, asset_id: &str, key: RecordingKey, mut on_event: impl FnMut(&Value)) -> Result<Value, String> {
    if !valid_id(asset_id) {
        return Err("invalid_id".into());
    }
    let dir = recordings_dir(app_data, asset_id);
    let manifest = super::archive::read_manifest(&dir).map_err(|_| "recording_missing")?;
    if manifest.segments.is_empty() {
        return Err("recording_empty".into());
    }
    let models_dir = app_data.join("models");
    for id in [PARAKEET_ID, VAD_ID] {
        let entry = catalog::model(id).ok_or("unknown_model")?;
        if !models::is_installed(&models_dir, id, entry) {
            return Err("models_missing".into());
        }
    }
    let pinned = |id: &str, key: &str| -> Result<Value, String> {
        let file = catalog::model(id).and_then(|m| m.files.get(key)).ok_or("unknown_model_file")?;
        Ok(json!({ "path": models::file_path(&models_dir, id, &file.name), "sha256": file.sha256 }))
    };
    let request = json!({
        "type": "startFinal",
        "id": "final",
        "language": "auto",
        "modelVersion": format!("{PARAKEET_ID}@sherpa-onnx-{}", catalog().sherpa_onnx_version),
        "model": { "encoder": pinned(PARAKEET_ID, "encoder")?, "decoder": pinned(PARAKEET_ID, "decoder")?,
                   "joiner": pinned(PARAKEET_ID, "joiner")?, "tokens": pinned(PARAKEET_ID, "tokens")? },
        "vad": pinned(VAD_ID, "model")?,
        "numThreads": super::tier::final_pass_threads(),
    });
    let total_sec = manifest.total_samples as f64 / SAMPLE_RATE as f64;
    let files: Vec<PathBuf> = manifest.segments.iter().map(|segment| dir.join(&segment.file)).collect();
    let feed = move |out: &mut dyn Write| -> std::io::Result<()> {
        for file in files {
            // Unreadable or tampered segments are skipped (GCM authentication fails), not fatal.
            let Ok(sealed) = std::fs::read(&file) else { continue };
            let Ok(wav) = key.decrypt(&sealed) else { continue };
            sidecar::write_raw_frame(out, 3, &wav)?;
        }
        sidecar::write_frame(out, &json!({ "type": "endFinal" }))
    };
    sidecar::run_with_feed(&request, feed, |event| {
        let mut event = event.clone();
        event["durationSec"] = json!(total_sec);
        on_event(&event);
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tone(freq: f64, rate: u32, seconds: f64) -> Vec<f32> {
        (0..(rate as f64 * seconds) as usize).map(|i| (2.0 * std::f64::consts::PI * freq * i as f64 / rate as f64).sin() as f32).collect()
    }

    /// Steady-state peak amplitude after resampling (skips the filter's start-up transient).
    fn output_peak(freq: f64, rate: u32) -> f32 {
        let mut resampler = Resampler::new(rate);
        let input = tone(freq, rate, 1.0);
        let out: Vec<f32> = input.chunks(rate as usize / 10).flat_map(|chunk| resampler.process(chunk)).collect();
        out[1_600..].iter().fold(0.0f32, |peak, s| peak.max(s.abs()))
    }

    #[test]
    fn produces_16k_samples_per_second_for_common_rates() {
        for rate in [48_000u32, 44_100, 32_000] {
            let mut resampler = Resampler::new(rate);
            let produced: usize = (0..10).map(|_| resampler.process(&vec![0.0; rate as usize / 10]).len()).sum();
            assert!((15_990..=16_000).contains(&produced), "{rate} Hz -> {produced}");
        }
    }

    #[test]
    fn passes_speech_band_and_blocks_aliasing_tones() {
        for rate in [48_000u32, 44_100] {
            let speech = output_peak(1_000.0, rate);
            assert!((0.9..=1.05).contains(&speech), "{rate} Hz: 1 kHz tone should pass, peak {speech}");
            // 12 kHz is above the 8 kHz output Nyquist: without filtering it would alias to 4 kHz.
            let alias = output_peak(12_000.0, rate);
            assert!(alias < 0.02, "{rate} Hz: 12 kHz tone should be removed, peak {alias}");
        }
    }

    /// End-to-end: real lecture audio → encrypted archive → finalize → Parakeet, checked by WER.
    /// INTELLINOTE_MODELS_DIR=~/.cache/intellinote-models INTELLINOTE_ASR_BIN=asr/target/release/intellinote-asr \
    ///   cargo test -- --ignored golden_final_pass
    #[test]
    #[ignore]
    fn golden_final_pass_from_encrypted_archive() {
        let models = PathBuf::from(std::env::var("INTELLINOTE_MODELS_DIR").expect("INTELLINOTE_MODELS_DIR"));
        let app_data = std::env::temp_dir().join(format!("intellinote-final-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&app_data);
        for id in [PARAKEET_ID, VAD_ID] {
            let entry = catalog::model(id).unwrap();
            let source = entry.archive_root.as_ref().map(|root| models.join(root)).unwrap_or_else(|| models.clone());
            std::fs::create_dir_all(models::install_dir(&app_data.join("models"), id)).unwrap();
            for file in entry.files.values() {
                std::fs::copy(source.join(&file.name), models::file_path(&app_data.join("models"), id, &file.name)).unwrap();
            }
        }
        // 16.7 s LibriSpeech clip (16 kHz, 16-bit) from the Nemotron archive: spans two 15 s segments.
        let clips = models.join("sherpa-onnx-nemotron-speech-streaming-en-0.6b-560ms-int8-2026-04-25/test_wavs");
        let wav = std::fs::read(clips.join("1.wav")).unwrap();
        let samples: Vec<f32> = wav[44..].chunks_exact(2).map(|b| i16::from_le_bytes([b[0], b[1]]) as f32 / 32768.0).collect();
        let key = RecordingKey::for_tests(9);
        let mut archive = ArchiveWriter::create(&recordings_dir(&app_data, "asset-golden"), key.clone()).unwrap();
        archive.push(&samples).unwrap();
        assert_eq!(archive.finish().unwrap().segments.len(), 2);

        let transcript = finalize(&app_data, "asset-golden", key, |_| {}).expect("final pass");
        let text: Vec<String> = transcript["segments"].as_array().unwrap().iter()
            .flat_map(|s| s["text"].as_str().unwrap().to_lowercase().split_whitespace().map(|w| w.trim_matches(|c: char| !c.is_alphanumeric()).to_string()).collect::<Vec<_>>())
            .filter(|w| !w.is_empty()).collect();
        let reference = std::fs::read_to_string(clips.join("trans.txt")).unwrap();
        let reference: Vec<String> = reference.lines().find_map(|l| l.strip_prefix("1.wav ")).unwrap().to_lowercase().split_whitespace().map(str::to_string).collect();
        // Word-level edit distance.
        let mut prev: Vec<usize> = (0..=text.len()).collect();
        for (i, r) in reference.iter().enumerate() {
            let mut cur = vec![i + 1; text.len() + 1];
            for (j, h) in text.iter().enumerate() {
                cur[j + 1] = (prev[j] + usize::from(r != h)).min(prev[j + 1] + 1).min(cur[j] + 1);
            }
            prev = cur;
        }
        let wer = prev[text.len()] as f64 / reference.len() as f64;
        assert!(wer <= 0.10, "WER {wer:.3}: {}", text.join(" "));
        assert!(transcript["segments"][0]["words"].as_array().map(|w| !w.is_empty()).unwrap_or(false), "word timestamps present");
        let _ = std::fs::remove_dir_all(&app_data);
    }

    #[test]
    fn downmixes_to_mono() {
        assert_eq!(to_mono(&[1.0, 0.0, 0.5, 0.5], 2), vec![0.5, 0.5]);
    }

    #[test]
    fn ids_cannot_escape_the_recordings_dir() {
        assert!(valid_id("asset-1a2b_3"));
        for bad in ["", "../etc", "a/b", "a\\b", "a.b", &"x".repeat(129)] {
            assert!(!valid_id(bad), "{bad}");
        }
    }
}
