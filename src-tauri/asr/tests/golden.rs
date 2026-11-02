//! Golden-audio WER gate. Runs the real sidecar binary over the model's bundled test clip and
//! fails if word error rate exceeds the threshold. This is what catches silent decoding
//! regressions from a sherpa-onnx or model bump.
//!
//! Needs the verified models on disk, so it is `#[ignore]`d by default:
//!   INTELLINOTE_MODELS_DIR=~/.cache/intellinote-models cargo test --release -- --ignored golden
//! Layout: `$INTELLINOTE_MODELS_DIR/<archiveRoot>/<files>` and `$INTELLINOTE_MODELS_DIR/silero_vad.onnx`.

use serde_json::{json, Value};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

const CATALOG: &str = include_str!("../../transcription-models.json");

/// Reference text for `test_wavs/en.wav`: John F. Kennedy's 1961 inaugural address, public record.
const EN_REFERENCE: &str = "ask not what your country can do for you ask what you can do for your country";
/// Baseline WER is 0.0 on sherpa-onnx 2.0.1; the margin allows one substitution on this 17-word clip.
const MAX_WER: f64 = 0.06;
/// Live (streaming) decoding is allowed slightly more error than the final pass.
const MAX_LIVE_WER: f64 = 0.10;

fn normalize(text: &str) -> Vec<String> {
    text.to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() || c.is_whitespace() || c == '\'' { c } else { ' ' })
        .collect::<String>()
        .split_whitespace()
        .map(str::to_string)
        .collect()
}

/// Word error rate = word-level Levenshtein distance / reference length.
fn wer(reference: &str, hypothesis: &str) -> f64 {
    let (r, h) = (normalize(reference), normalize(hypothesis));
    let mut prev: Vec<usize> = (0..=h.len()).collect();
    for (i, rw) in r.iter().enumerate() {
        let mut cur = vec![i + 1; h.len() + 1];
        for (j, hw) in h.iter().enumerate() {
            let cost = usize::from(rw != hw);
            cur[j + 1] = (prev[j] + cost).min(prev[j + 1] + 1).min(cur[j] + 1);
        }
        prev = cur;
    }
    prev[h.len()] as f64 / r.len().max(1) as f64
}

fn pinned(dir: &Path, model: &Value, key: &str) -> Value {
    let root = model["archiveRoot"].as_str().map(|root| dir.join(root)).unwrap_or_else(|| dir.to_path_buf());
    let file = &model["files"][key];
    json!({ "path": root.join(file["name"].as_str().unwrap()), "sha256": file["sha256"] })
}

fn frame(value: &Value) -> Vec<u8> {
    let body = value.to_string().into_bytes();
    let mut out = ((body.len() + 1) as u32).to_le_bytes().to_vec();
    out.push(1);
    out.extend(body);
    out
}

fn read_message(reader: &mut impl Read) -> Option<Value> {
    let mut len = [0u8; 4];
    reader.read_exact(&mut len).ok()?;
    let mut buf = vec![0u8; u32::from_le_bytes(len) as usize];
    reader.read_exact(&mut buf).ok()?;
    serde_json::from_slice(&buf[1..]).ok()
}

fn transcribe(audio: &Path, dir: &Path) -> String {
    let catalog: Value = serde_json::from_str(CATALOG).unwrap();
    let parakeet = &catalog["models"]["parakeet-tdt-0.6b-v3-int8"];
    let request = json!({
        "type": "transcribeFile", "id": "golden", "audioPath": audio, "language": "en",
        "modelVersion": "parakeet-tdt-0.6b-v3-int8",
        "model": {
            "encoder": pinned(dir, parakeet, "encoder"), "decoder": pinned(dir, parakeet, "decoder"),
            "joiner": pinned(dir, parakeet, "joiner"), "tokens": pinned(dir, parakeet, "tokens"),
        },
        "vad": pinned(dir, &catalog["models"]["silero-vad"], "model"),
    });
    let mut child = Command::new(env!("CARGO_BIN_EXE_intellinote-asr"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .expect("spawn sidecar");
    child.stdin.as_mut().unwrap().write_all(&frame(&request)).unwrap();
    let stdout = child.stdout.as_mut().unwrap();
    let text = loop {
        let message = read_message(stdout).expect("sidecar closed without a result");
        match message["type"].as_str() {
            Some("result") => {
                break message["transcript"]["segments"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|segment| segment["text"].as_str().unwrap().to_string())
                    .collect::<Vec<_>>()
                    .join(" ")
            }
            Some("error") => panic!("sidecar error: {}", message["code"]),
            _ => continue,
        }
    };
    drop(child.stdin.take());
    child.wait().unwrap();
    text
}

/// Streams a 16 kHz mono WAV through the live path (startStream → PCM frames → stopStream).
fn stream_live(audio: &Path, dir: &Path) -> String {
    let catalog: Value = serde_json::from_str(CATALOG).unwrap();
    let nemotron = &catalog["models"]["nemotron-speech-streaming-en-0.6b-560ms-int8"];
    let start = json!({
        "type": "startStream", "modelVersion": "nemotron-560",
        "model": {
            "encoder": pinned(dir, nemotron, "encoder"), "decoder": pinned(dir, nemotron, "decoder"),
            "joiner": pinned(dir, nemotron, "joiner"), "tokens": pinned(dir, nemotron, "tokens"),
        },
        "vad": pinned(dir, &catalog["models"]["silero-vad"], "model"),
    });
    let wave = sherpa_onnx::Wave::read(audio.to_str().unwrap()).expect("read wav");
    assert_eq!(wave.sample_rate(), 16_000);
    let mut child = Command::new(env!("CARGO_BIN_EXE_intellinote-asr"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .expect("spawn sidecar");
    let mut stdin = child.stdin.take().unwrap();
    stdin.write_all(&frame(&start)).unwrap();
    // 100 ms PCM frames, then 2 s of silence so the last utterance is committed.
    let mut samples = wave.samples().to_vec();
    samples.extend(std::iter::repeat(0.0).take(32_000));
    for chunk in samples.chunks(1_600) {
        let bytes: Vec<u8> = chunk.iter().flat_map(|s| s.to_le_bytes()).collect();
        let mut out = ((bytes.len() + 1) as u32).to_le_bytes().to_vec();
        out.push(2);
        out.extend(bytes);
        stdin.write_all(&out).unwrap();
    }
    stdin.write_all(&frame(&json!({ "type": "stopStream" }))).unwrap();
    drop(stdin);
    let stdout = child.stdout.as_mut().unwrap();
    let mut finals = Vec::new();
    while let Some(message) = read_message(stdout) {
        match message["type"].as_str() {
            Some("final") => finals.push(message["segment"]["text"].as_str().unwrap().to_string()),
            Some("error") => panic!("sidecar error: {}", message["code"]),
            Some("streamStopped") => break,
            _ => {}
        }
    }
    child.wait().unwrap();
    finals.join(" ")
}

#[test]
fn wer_metric_is_correct() {
    assert_eq!(wer("a b c d", "a b c d"), 0.0);
    assert_eq!(wer("a b c d", "a x c d"), 0.25);
    assert_eq!(wer("a b c d", "a c d"), 0.25);
    assert_eq!(wer("Ask, not!", "ask not"), 0.0); // punctuation and case are ignored
}

#[test]
#[ignore]
fn golden_parakeet_en_wer() {
    let dir = PathBuf::from(std::env::var("INTELLINOTE_MODELS_DIR").expect("set INTELLINOTE_MODELS_DIR"));
    let audio = dir.join("sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8/test_wavs/en.wav");
    let hypothesis = transcribe(&audio, &dir);
    let score = wer(EN_REFERENCE, &hypothesis);
    assert!(score <= MAX_WER, "WER {score:.3} > {MAX_WER} (hypothesis: {hypothesis})");
}

#[test]
#[ignore]
fn golden_nemotron_live_wer() {
    let dir = PathBuf::from(std::env::var("INTELLINOTE_MODELS_DIR").expect("set INTELLINOTE_MODELS_DIR"));
    let root = dir.join("sherpa-onnx-nemotron-speech-streaming-en-0.6b-560ms-int8-2026-04-25/test_wavs");
    // References ship with the model archive (trans.txt, LibriSpeech ground truth).
    let references = std::fs::read_to_string(root.join("trans.txt")).unwrap();
    for name in ["0.wav", "1.wav"] {
        let reference = references.lines().find_map(|line| line.strip_prefix(&format!("{name} "))).unwrap();
        let hypothesis = stream_live(&root.join(name), &dir);
        let score = wer(reference, &hypothesis);
        // Baseline on sherpa-onnx 2.0.1: 1.wav has one split word ("for ever" vs "forever").
        assert!(score <= MAX_LIVE_WER, "{name}: WER {score:.3} > {MAX_LIVE_WER} (hypothesis: {hypothesis})");
    }
}
