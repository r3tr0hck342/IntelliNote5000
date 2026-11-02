//! Live streaming recognition: one persistent Nemotron stream per recording, gated by Silero VAD.
//!
//! Silence is not fed to the recognizer (saves CPU on long lectures). A short pre-roll keeps word
//! onsets, and a hangover keeps word endings; when the hangover runs out the current utterance is
//! committed as a final segment and the stream is reset for the next one.
//! Live segments carry text and timing only; the Parakeet final pass provides word timestamps.

use crate::transcribe::{create_vad, AsrError, TransducerModel};
use crate::verify::{verify, PinnedFile};
use serde::Serialize;
use sherpa_onnx::{OnlineRecognizer, OnlineRecognizerConfig, OnlineStream, OnlineTransducerModelConfig, VoiceActivityDetector};
use std::collections::VecDeque;

const SAMPLE_RATE: usize = 16_000;
const VAD_WINDOW: usize = 512;
const PRE_ROLL_SAMPLES: usize = SAMPLE_RATE / 2; // 0.5 s
const HANGOVER_SAMPLES: usize = SAMPLE_RATE; // 1.0 s

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveSegment {
    pub id: String,
    pub start: f64,
    pub end: f64,
    pub text: String,
    pub is_final: bool,
    pub words: Vec<()>,
}

#[derive(Debug)]
pub enum LiveEvent {
    Partial(String),
    Final(LiveSegment),
}

pub fn create_nemotron(model: &TransducerModel, num_threads: i32) -> Result<OnlineRecognizer, AsrError> {
    for file in [&model.encoder, &model.decoder, &model.joiner, &model.tokens] {
        verify(file)?;
    }
    let mut config = OnlineRecognizerConfig::default();
    config.model_config.transducer = OnlineTransducerModelConfig {
        encoder: Some(model.encoder.path.clone()),
        decoder: Some(model.decoder.path.clone()),
        joiner: Some(model.joiner.path.clone()),
    };
    config.model_config.tokens = Some(model.tokens.path.clone());
    config.model_config.provider = Some("cpu".into());
    config.model_config.num_threads = num_threads.max(1);
    config.decoding_method = Some("greedy_search".into());
    // Endpoint rules: sherpa-onnx's documented defaults (2.4 s / 1.2 s trailing silence, 20 s max).
    config.enable_endpoint = true;
    config.rule1_min_trailing_silence = 2.4;
    config.rule2_min_trailing_silence = 1.2;
    config.rule3_min_utterance_length = 20.0;
    OnlineRecognizer::create(&config).ok_or(AsrError::ModelLoadFailed)
}

pub struct LiveSession {
    recognizer: OnlineRecognizer,
    stream: OnlineStream,
    vad: VoiceActivityDetector,
    pending: Vec<f32>,
    pre_roll: VecDeque<f32>,
    hangover: usize,
    /// Samples received from the app so far (timeline of the recording).
    received: usize,
    /// Recording position where the current utterance started, if one is open.
    utterance_start: Option<usize>,
    last_partial: String,
    segments: usize,
}

impl LiveSession {
    pub fn new(model: &TransducerModel, vad_model: &PinnedFile, num_threads: i32) -> Result<Self, AsrError> {
        let recognizer = create_nemotron(model, num_threads)?;
        let stream = recognizer.create_stream();
        let vad = create_vad(vad_model)?;
        Ok(Self {
            recognizer,
            stream,
            vad,
            pending: Vec::new(),
            pre_roll: VecDeque::with_capacity(PRE_ROLL_SAMPLES),
            hangover: 0,
            received: 0,
            utterance_start: None,
            last_partial: String::new(),
            segments: 0,
        })
    }

    /// Feeds 16 kHz mono samples; returns partial/final events produced by them.
    pub fn accept(&mut self, samples: &[f32]) -> Vec<LiveEvent> {
        let mut events = Vec::new();
        self.pending.extend_from_slice(samples);
        let whole = self.pending.len() - self.pending.len() % VAD_WINDOW;
        let windows: Vec<f32> = self.pending.drain(..whole).collect();
        for window in windows.chunks(VAD_WINDOW) {
            self.vad.accept_waveform(window);
            while self.vad.front().is_some() {
                self.vad.pop(); // only `detected()` is used; drop buffered segments
            }
            self.received += window.len();
            if self.vad.detected() {
                if self.utterance_start.is_none() {
                    self.utterance_start = Some(self.received - window.len() - self.pre_roll.len());
                    let pre_roll: Vec<f32> = self.pre_roll.drain(..).collect();
                    self.stream.accept_waveform(SAMPLE_RATE as i32, &pre_roll);
                }
                self.hangover = HANGOVER_SAMPLES;
                self.feed(window, &mut events);
            } else if self.utterance_start.is_some() && self.hangover > 0 {
                self.hangover = self.hangover.saturating_sub(window.len());
                self.feed(window, &mut events);
                if self.hangover == 0 {
                    self.commit(&mut events);
                }
            } else {
                self.pre_roll.extend(window.iter().copied());
                while self.pre_roll.len() > PRE_ROLL_SAMPLES {
                    self.pre_roll.pop_front();
                }
            }
        }
        events
    }

    /// Commits whatever is in progress (called on stop).
    pub fn finish(&mut self) -> Vec<LiveEvent> {
        let mut events = Vec::new();
        if self.utterance_start.is_some() {
            // Trailing silence lets the decoder emit the last tokens before committing.
            self.stream.accept_waveform(SAMPLE_RATE as i32, &vec![0.0; SAMPLE_RATE / 2]);
            self.decode_ready(&mut events);
            self.commit(&mut events);
        }
        events
    }

    fn feed(&mut self, window: &[f32], events: &mut Vec<LiveEvent>) {
        self.stream.accept_waveform(SAMPLE_RATE as i32, window);
        self.decode_ready(events);
        if self.recognizer.is_endpoint(&self.stream) {
            self.commit(events);
            // Speech may continue past an endpoint (rule 3: 20 s cap): start a new utterance now.
            if self.hangover > 0 {
                self.utterance_start = Some(self.received);
            }
        }
    }

    fn decode_ready(&mut self, events: &mut Vec<LiveEvent>) {
        while self.recognizer.is_ready(&self.stream) {
            self.recognizer.decode(&self.stream);
        }
        let text = self.current_text();
        if text != self.last_partial {
            self.last_partial = text.clone();
            events.push(LiveEvent::Partial(text));
        }
    }

    fn current_text(&self) -> String {
        self.recognizer.get_result(&self.stream).map(|result| result.text.trim().to_string()).unwrap_or_default()
    }

    fn commit(&mut self, events: &mut Vec<LiveEvent>) {
        let text = self.current_text();
        let start = self.utterance_start.take().unwrap_or(self.received);
        if !text.is_empty() {
            events.push(LiveEvent::Final(LiveSegment {
                id: format!("live-{}", self.segments),
                start: start as f64 / SAMPLE_RATE as f64,
                end: self.received as f64 / SAMPLE_RATE as f64,
                text,
                is_final: true,
                words: Vec::new(),
            }));
            self.segments += 1;
        }
        self.recognizer.reset(&self.stream);
        self.last_partial.clear();
        self.hangover = 0;
    }
}

/// Decodes kind-2 frames: little-endian f32 samples. Returns `None` on a misaligned payload.
pub fn pcm_from_bytes(payload: &[u8]) -> Option<Vec<f32>> {
    if payload.len() % 4 != 0 {
        return None;
    }
    Some(payload.chunks_exact(4).map(|bytes| f32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]])).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_little_endian_pcm() {
        let bytes: Vec<u8> = [0.5f32, -1.0].iter().flat_map(|v| v.to_le_bytes()).collect();
        assert_eq!(pcm_from_bytes(&bytes), Some(vec![0.5, -1.0]));
        assert_eq!(pcm_from_bytes(&[0, 0, 0]), None);
    }
}
