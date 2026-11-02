//! Offline (final-pass) transcription: Silero VAD splits audio into speech segments, Parakeet TDT
//! decodes each one. Output follows the app's Transcript schema (services/transcription/schema.ts).

use crate::verify::{verify, PinnedFile, VerifyError};
use serde::{Deserialize, Serialize};
use sherpa_onnx::{
    OfflineRecognizer, OfflineRecognizerConfig, OfflineTransducerModelConfig, SileroVadModelConfig,
    VadModelConfig, VoiceActivityDetector,
};

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TransducerModel {
    pub encoder: PinnedFile,
    pub decoder: PinnedFile,
    pub joiner: PinnedFile,
    pub tokens: PinnedFile,
}

#[derive(Debug, Serialize, PartialEq)]
pub struct Word {
    pub w: String,
    pub start: f64,
    pub end: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Segment {
    pub id: String,
    pub start: f64,
    pub end: f64,
    pub text: String,
    pub is_final: bool,
    pub words: Vec<Word>,
}

#[derive(Debug, PartialEq)]
pub enum AsrError {
    ModelHashMismatch,
    ModelUnreadable,
    ModelLoadFailed,
}

impl From<VerifyError> for AsrError {
    fn from(err: VerifyError) -> Self {
        match err {
            VerifyError::Mismatch => AsrError::ModelHashMismatch,
            VerifyError::Unreadable => AsrError::ModelUnreadable,
        }
    }
}

const SAMPLE_RATE: i32 = 16_000;
const VAD_WINDOW: usize = 512; // Silero's window at 16 kHz, as in the official Rust example
/// Parakeet handles long inputs, but bounded segments keep memory flat on 90-minute files.
const MAX_SEGMENT_SEC: f32 = 20.0;

pub fn create_parakeet(model: &TransducerModel, num_threads: i32) -> Result<OfflineRecognizer, AsrError> {
    for file in [&model.encoder, &model.decoder, &model.joiner, &model.tokens] {
        verify(file)?;
    }
    // Same configuration as rust-api-examples/examples/nemo_parakeet.rs at v2.0.1.
    let mut config = OfflineRecognizerConfig::default();
    config.model_config.transducer = OfflineTransducerModelConfig {
        encoder: Some(model.encoder.path.clone()),
        decoder: Some(model.decoder.path.clone()),
        joiner: Some(model.joiner.path.clone()),
    };
    config.model_config.tokens = Some(model.tokens.path.clone());
    config.model_config.provider = Some("cpu".into());
    config.model_config.num_threads = num_threads.max(1);
    OfflineRecognizer::create(&config).ok_or(AsrError::ModelLoadFailed)
}

pub fn create_vad(model: &PinnedFile) -> Result<VoiceActivityDetector, AsrError> {
    verify(model)?;
    // Thresholds from rust-api-examples/examples/silero_vad_remove_silence.rs at v2.0.1.
    let mut silero = SileroVadModelConfig::default();
    silero.model = Some(model.path.clone());
    silero.threshold = 0.5;
    silero.min_silence_duration = 0.25;
    silero.min_speech_duration = 0.25;
    silero.max_speech_duration = MAX_SEGMENT_SEC;
    let config = VadModelConfig {
        silero_vad: silero,
        ten_vad: Default::default(),
        sample_rate: SAMPLE_RATE,
        num_threads: 1,
        provider: Some("cpu".into()),
        debug: false,
    };
    VoiceActivityDetector::create(&config, 60.0).ok_or(AsrError::ModelLoadFailed)
}

/// BPE pieces start a new word when they carry SentencePiece's `▁` marker (or a leading space).
pub fn words_from_tokens(tokens: &[String], timestamps: &[f32], durations: Option<&[f32]>, offset: f64) -> Vec<Word> {
    let mut words: Vec<Word> = Vec::new();
    for (index, token) in tokens.iter().enumerate() {
        let Some(&start) = timestamps.get(index) else { break };
        let end = match durations.and_then(|d| d.get(index)) {
            Some(&duration) if duration > 0.0 => start + duration,
            _ => timestamps.get(index + 1).copied().unwrap_or(start + 0.08),
        };
        let starts_word = token.starts_with('\u{2581}') || token.starts_with(' ');
        let piece = token.trim_start_matches('\u{2581}').trim_start();
        match words.last_mut() {
            Some(word) if !starts_word => {
                word.w.push_str(piece);
                word.end = offset + end as f64;
            }
            _ if piece.is_empty() => {}
            _ => words.push(Word { w: piece.to_string(), start: offset + start as f64, end: offset + end as f64 }),
        }
    }
    words
}

pub struct FileTranscriber {
    recognizer: OfflineRecognizer,
    vad: VoiceActivityDetector,
    pending: Vec<f32>,
    segments: Vec<Segment>,
}

impl FileTranscriber {
    pub fn new(recognizer: OfflineRecognizer, vad: VoiceActivityDetector) -> Self {
        Self { recognizer, vad, pending: Vec::new(), segments: Vec::new() }
    }

    /// Feeds 16 kHz mono samples; returns how many new segments were produced.
    pub fn accept(&mut self, samples: &[f32]) -> usize {
        self.pending.extend_from_slice(samples);
        let whole = self.pending.len() - self.pending.len() % VAD_WINDOW;
        for window in self.pending[..whole].chunks(VAD_WINDOW) {
            self.vad.accept_waveform(window);
        }
        self.pending.drain(..whole);
        self.drain_segments()
    }

    pub fn finish(mut self) -> Vec<Segment> {
        if !self.pending.is_empty() {
            let rest = std::mem::take(&mut self.pending);
            self.vad.accept_waveform(&rest);
        }
        self.vad.flush();
        self.drain_segments();
        self.segments
    }

    fn drain_segments(&mut self) -> usize {
        let before = self.segments.len();
        while let Some(speech) = self.vad.front() {
            let offset = speech.start() as f64 / SAMPLE_RATE as f64;
            let samples = speech.samples().to_vec();
            self.vad.pop();
            self.decode_segment(offset, &samples);
        }
        self.segments.len() - before
    }

    fn decode_segment(&mut self, offset: f64, samples: &[f32]) {
        let stream = self.recognizer.create_stream();
        stream.accept_waveform(SAMPLE_RATE, samples);
        self.recognizer.decode(&stream);
        let Some(result) = stream.get_result() else { return };
        let text = result.text.trim().to_string();
        if text.is_empty() {
            return;
        }
        let words = words_from_tokens(
            &result.tokens,
            result.timestamps.as_deref().unwrap_or(&[]),
            result.durations.as_deref(),
            offset,
        );
        let end = offset + samples.len() as f64 / SAMPLE_RATE as f64;
        self.segments.push(Segment {
            id: format!("seg-{}", self.segments.len()),
            start: offset,
            end,
            text,
            is_final: true,
            words,
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn s(items: &[&str]) -> Vec<String> {
        items.iter().map(|item| item.to_string()).collect()
    }

    #[test]
    fn merges_bpe_pieces_into_words_with_offsets() {
        let tokens = s(&["\u{2581}Hel", "lo", ",", "\u{2581}class", "."]);
        let timestamps = [0.0, 0.1, 0.2, 0.4, 0.7];
        let words = words_from_tokens(&tokens, &timestamps, None, 10.0);
        assert_eq!(
            words,
            vec![
                Word { w: "Hello,".into(), start: 10.0, end: 10.0 + 0.4f32 as f64 },
                Word { w: "class.".into(), start: 10.0 + 0.4f32 as f64, end: 10.0 + (0.7f32 + 0.08) as f64 },
            ]
        );
    }

    #[test]
    fn uses_tdt_durations_for_word_ends() {
        let words = words_from_tokens(&s(&["\u{2581}cell", "s"]), &[1.0, 1.2], Some(&[0.2, 0.3]), 0.0);
        assert_eq!(words.len(), 1);
        assert_eq!(words[0].w, "cells");
        assert!((words[0].end - 1.5).abs() < 1e-6);
    }

    #[test]
    fn tolerates_missing_timestamps() {
        assert!(words_from_tokens(&s(&["\u{2581}a"]), &[], None, 0.0).is_empty());
    }
}
