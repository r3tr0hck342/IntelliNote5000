//! Decodes an audio/video file to 16 kHz mono f32, streaming chunks to a callback so a 90-minute
//! file never has to sit in memory at once. Media files are untrusted input; this runs inside the
//! sidecar so a decoder bug cannot take down the app.

use sherpa_onnx::LinearResampler;
use std::fs::File;
use std::path::Path;
use symphonia::core::codecs::audio::AudioDecoderOptions;
use symphonia::core::errors::Error as SymphoniaError;
use symphonia::core::formats::probe::Hint;
use symphonia::core::formats::{FormatOptions, TrackType};
use symphonia::core::io::{MediaSourceStream, MediaSourceStreamOptions};
use symphonia::core::meta::MetadataOptions;

pub const TARGET_SAMPLE_RATE: i32 = 16_000;

#[derive(Debug, PartialEq)]
pub enum DecodeError {
    Unreadable,
    /// Container or codec not supported (e.g. Opus); the app can retry through system ffmpeg.
    Unsupported,
    Corrupt,
}

/// Duration in seconds when the container reports it, so the app can show progress.
pub struct DecodeInfo {
    pub duration_sec: Option<f64>,
}

pub fn decode_to_16k_mono(
    path: &Path,
    mut on_chunk: impl FnMut(&[f32]),
    mut on_info: impl FnMut(DecodeInfo),
) -> Result<(), DecodeError> {
    let file = File::open(path).map_err(|_| DecodeError::Unreadable)?;
    let mss = MediaSourceStream::new(Box::new(file), MediaSourceStreamOptions::default());
    let mut hint = Hint::new();
    if let Some(extension) = path.extension().and_then(|ext| ext.to_str()) {
        hint.with_extension(extension);
    }
    let mut format = symphonia::default::get_probe()
        .probe(&hint, mss, FormatOptions::default(), MetadataOptions::default())
        .map_err(|_| DecodeError::Unsupported)?;

    let track = format.first_track_known_codec(TrackType::Audio).ok_or(DecodeError::Unsupported)?;
    let track_id = track.id;
    let params = track
        .codec_params
        .as_ref()
        .and_then(|params| params.audio())
        .ok_or(DecodeError::Unsupported)?
        .clone();
    on_info(DecodeInfo {
        duration_sec: match (track.num_frames, params.sample_rate) {
            (Some(frames), Some(rate)) if rate > 0 => Some(frames as f64 / rate as f64),
            _ => None,
        },
    });

    let mut decoder = symphonia::default::get_codecs()
        .make_audio_decoder(&params, &AudioDecoderOptions::default())
        .map_err(|_| DecodeError::Unsupported)?;

    let mut resampler: Option<(u32, LinearResampler)> = None;
    let mut interleaved: Vec<f32> = Vec::new();
    let mut decoded_any = false;

    loop {
        let packet = match format.next_packet() {
            Ok(Some(packet)) => packet,
            Ok(None) => break,
            Err(SymphoniaError::IoError(err)) if err.kind() == std::io::ErrorKind::UnexpectedEof => break,
            Err(_) => return Err(DecodeError::Corrupt),
        };
        if packet.track_id != track_id {
            continue;
        }
        let buffer = match decoder.decode(&packet) {
            Ok(buffer) => buffer,
            // A single bad packet is skipped, as symphonia's own player does.
            Err(SymphoniaError::DecodeError(_)) => continue,
            Err(_) => return Err(DecodeError::Corrupt),
        };
        let rate = buffer.spec().rate();
        let channels = buffer.spec().channels().count().max(1);
        interleaved.clear();
        buffer.copy_to_vec_interleaved(&mut interleaved);
        let mono: Vec<f32> = interleaved
            .chunks(channels)
            .map(|frame| frame.iter().sum::<f32>() / channels as f32)
            .collect();
        decoded_any = true;

        if rate as i32 == TARGET_SAMPLE_RATE {
            on_chunk(&mono);
            continue;
        }
        if resampler.as_ref().map(|(r, _)| *r) != Some(rate) {
            let created = LinearResampler::create(rate as i32, TARGET_SAMPLE_RATE).ok_or(DecodeError::Unsupported)?;
            resampler = Some((rate, created));
        }
        let (_, active) = resampler.as_ref().expect("resampler set above");
        on_chunk(&active.resample(&mono, false));
    }

    if let Some((_, active)) = resampler {
        let tail = active.resample(&[], true);
        if !tail.is_empty() {
            on_chunk(&tail);
        }
    }
    if decoded_any {
        Ok(())
    } else {
        Err(DecodeError::Corrupt)
    }
}
