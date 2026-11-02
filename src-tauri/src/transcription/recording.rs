//! Native lecture recording: capture → archive (always) → live recognizer (when it keeps up).
//!
//! Capture callbacks only forward samples to a worker thread, so they never block. The worker
//! writes the encrypted archive first, then offers audio to a bounded queue feeding the sidecar.
//! If that queue fills (CPU can't keep up) or the sidecar dies, the session switches to
//! record-only: audio is still archived and the final pass transcribes it later. Audio is never
//! dropped. The recording lives in the backend, so it survives a webview reload.

use super::archive::{ArchiveWriter, SAMPLE_RATE};
use super::catalog::{self, catalog, VAD_ID};
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

/// Down-mixes interleaved frames to mono and resamples to 16 kHz by averaging each output
/// sample's source window (a box filter: enough anti-aliasing for speech ASR).
/// shortcut: box-filter resampler, upgrade to a polyphase/sinc resampler if ASR quality on
/// 44.1/48 kHz input measurably trails 16 kHz input.
pub struct Resampler {
    ratio: f64,
    position: f64,
    carry: Vec<f32>,
}

impl Resampler {
    pub fn new(input_rate: u32) -> Self {
        Self { ratio: input_rate as f64 / SAMPLE_RATE as f64, position: 0.0, carry: Vec::new() }
    }

    pub fn process(&mut self, mono: &[f32]) -> Vec<f32> {
        if (self.ratio - 1.0).abs() < f64::EPSILON {
            return mono.to_vec();
        }
        self.carry.extend_from_slice(mono);
        let mut out = Vec::with_capacity((self.carry.len() as f64 / self.ratio) as usize + 1);
        while self.position + self.ratio <= self.carry.len() as f64 {
            let start = self.position as usize;
            let end = ((self.position + self.ratio) as usize).max(start + 1).min(self.carry.len());
            let window = &self.carry[start..end];
            out.push(window.iter().sum::<f32>() / window.len() as f32);
            self.position += self.ratio;
        }
        let consumed = self.position as usize;
        self.carry.drain(..consumed);
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
    let asr = start_asr(&app_data.join("models"), &events, &record_only);
    if asr.is_none() {
        record_only.store(true, Ordering::SeqCst);
        emit(&events, json!({ "type": "recordOnly", "reason": "models_missing" }));
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resamples_48k_to_16k_at_the_right_rate() {
        let mut resampler = Resampler::new(48_000);
        let mut produced = 0;
        for _ in 0..10 {
            produced += resampler.process(&vec![0.25; 4_800]).len(); // 10 × 100 ms
        }
        assert!((15_998..=16_000).contains(&produced), "1 s in, ~1 s out: {produced}");
        assert!(resampler.process(&[0.25; 3]).iter().all(|s| (s - 0.25).abs() < 1e-6));
    }

    #[test]
    fn handles_non_integer_ratios() {
        let mut resampler = Resampler::new(44_100);
        let produced: usize = (0..10).map(|_| resampler.process(&vec![0.0; 4_410]).len()).sum();
        assert!((15_998..=16_000).contains(&produced), "{produced}");
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
