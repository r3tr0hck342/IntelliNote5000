//! Always-on recording archive, independent of transcription.
//!
//! Audio is written as 15 s WAV segments (16 kHz mono, 16-bit), each encrypted, written to `.partial`,
//! fsynced, then atomically renamed. `manifest.json` is rewritten the same way after every segment.
//! A crash loses at most the segment in progress; a transcription failure loses nothing.

use super::crypto::RecordingKey;
use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::{self, Write};
use std::path::{Path, PathBuf};

pub const SAMPLE_RATE: usize = 16_000;
const SEGMENT_SAMPLES: usize = SAMPLE_RATE * 15;

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub version: u32,
    pub sample_rate: u32,
    pub encrypted: bool,
    pub segments: Vec<SegmentEntry>,
    pub total_samples: u64,
    /// False until the recording is stopped cleanly; a crashed recording stays recoverable.
    pub complete: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SegmentEntry {
    pub file: String,
    pub samples: u64,
}

pub struct ArchiveWriter {
    dir: PathBuf,
    key: RecordingKey,
    buffer: Vec<f32>,
    manifest: Manifest,
}

/// Writes `bytes` to `path` via `<path>.partial` + fsync + rename, so readers never see a torn file.
pub fn write_atomic(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let partial = path.with_extension(format!("{}.partial", path.extension().and_then(|e| e.to_str()).unwrap_or("")));
    {
        let mut file = File::create(&partial)?;
        file.write_all(bytes)?;
        file.sync_all()?;
    }
    fs::rename(&partial, path)?;
    if let Some(parent) = path.parent() {
        // Persist the rename itself (directory entry) where the platform allows it.
        if let Ok(dir) = File::open(parent) {
            let _ = dir.sync_all();
        }
    }
    Ok(())
}

/// 16-bit PCM WAV, 16 kHz mono. (FLAC was tried first, but flacenc 0.5.1 output fails
/// symphonia 0.6.1's probe with UnexpectedEof; WAV decodes everywhere at ~1.7x the size.)
pub fn encode_wav(samples: &[f32]) -> Vec<u8> {
    let data_len = (samples.len() * 2) as u32;
    let mut out = Vec::with_capacity(44 + samples.len() * 2);
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(36 + data_len).to_le_bytes());
    out.extend_from_slice(b"WAVEfmt ");
    out.extend_from_slice(&16u32.to_le_bytes()); // PCM fmt chunk size
    out.extend_from_slice(&1u16.to_le_bytes()); // PCM
    out.extend_from_slice(&1u16.to_le_bytes()); // mono
    out.extend_from_slice(&(SAMPLE_RATE as u32).to_le_bytes());
    out.extend_from_slice(&(SAMPLE_RATE as u32 * 2).to_le_bytes()); // byte rate
    out.extend_from_slice(&2u16.to_le_bytes()); // block align
    out.extend_from_slice(&16u16.to_le_bytes()); // bits per sample
    out.extend_from_slice(b"data");
    out.extend_from_slice(&data_len.to_le_bytes());
    for sample in samples {
        out.extend_from_slice(&((sample.clamp(-1.0, 1.0) * i16::MAX as f32) as i16).to_le_bytes());
    }
    out
}

impl ArchiveWriter {
    pub fn create(dir: &Path, key: RecordingKey) -> io::Result<Self> {
        fs::create_dir_all(dir)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(dir, fs::Permissions::from_mode(0o700))?;
        }
        let writer = Self {
            dir: dir.to_path_buf(),
            key,
            buffer: Vec::with_capacity(SEGMENT_SAMPLES),
            manifest: Manifest { version: 1, sample_rate: SAMPLE_RATE as u32, encrypted: true, ..Manifest::default() },
        };
        writer.write_manifest()?;
        Ok(writer)
    }

    pub fn push(&mut self, samples: &[f32]) -> io::Result<()> {
        self.buffer.extend_from_slice(samples);
        while self.buffer.len() >= SEGMENT_SAMPLES {
            let segment: Vec<f32> = self.buffer.drain(..SEGMENT_SAMPLES).collect();
            self.write_segment(&segment)?;
        }
        Ok(())
    }

    pub fn finish(mut self) -> io::Result<Manifest> {
        if !self.buffer.is_empty() {
            let rest = std::mem::take(&mut self.buffer);
            self.write_segment(&rest)?;
        }
        self.manifest.complete = true;
        self.write_manifest()?;
        Ok(self.manifest)
    }

    pub fn total_samples(&self) -> u64 {
        self.manifest.total_samples + self.buffer.len() as u64
    }

    fn write_segment(&mut self, samples: &[f32]) -> io::Result<()> {
        let name = format!("seg-{:06}.wav.enc", self.manifest.segments.len());
        write_atomic(&self.dir.join(&name), &self.key.encrypt(&encode_wav(samples)))?;
        self.manifest.segments.push(SegmentEntry { file: name, samples: samples.len() as u64 });
        self.manifest.total_samples += samples.len() as u64;
        self.write_manifest()
    }

    fn write_manifest(&self) -> io::Result<()> {
        let json = serde_json::to_vec_pretty(&self.manifest).map_err(io::Error::other)?;
        write_atomic(&self.dir.join("manifest.json"), &json)
    }
}

pub fn read_manifest(dir: &Path) -> io::Result<Manifest> {
    serde_json::from_slice(&fs::read(dir.join("manifest.json"))?).map_err(io::Error::other)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("intellinote-archive-test-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    fn tone(len: usize) -> Vec<f32> {
        (0..len).map(|i| (i as f32 * 0.05).sin() * 0.3).collect()
    }

    #[test]
    fn writes_encrypted_segments_and_a_complete_manifest() {
        let dir = temp_dir("full");
        let key = RecordingKey::for_tests(1);
        let mut writer = ArchiveWriter::create(&dir, key.clone()).unwrap();
        writer.push(&tone(SEGMENT_SAMPLES + 1000)).unwrap();
        // One full segment is on disk before stop; the remainder is still buffered.
        let mid = read_manifest(&dir).unwrap();
        assert_eq!(mid.segments.len(), 1);
        assert!(!mid.complete, "an in-progress recording is marked incomplete");
        let manifest = writer.finish().unwrap();
        assert!(manifest.complete);
        assert_eq!(manifest.total_samples, (SEGMENT_SAMPLES + 1000) as u64);
        assert_eq!(manifest, read_manifest(&dir).unwrap());

        let sealed = fs::read(dir.join(&manifest.segments[0].file)).unwrap();
        assert_ne!(&sealed[..4], b"RIFF", "segments are not stored in the clear");
        assert_eq!(&key.decrypt(&sealed).unwrap()[..4], b"RIFF", "decrypts to a WAV stream");
        assert!(fs::read_dir(&dir).unwrap().all(|entry| !entry.unwrap().file_name().to_string_lossy().ends_with(".partial")));
    }

    #[test]
    fn interrupted_write_never_replaces_a_good_file() {
        let dir = temp_dir("atomic");
        fs::create_dir_all(&dir).unwrap();
        let target = dir.join("manifest.json");
        write_atomic(&target, b"good").unwrap();
        // Simulate a crash after the .partial was written but before the rename.
        fs::write(dir.join("manifest.json.partial"), b"half-writ").unwrap();
        assert_eq!(fs::read(&target).unwrap(), b"good");
        write_atomic(&target, b"newer").unwrap();
        assert_eq!(fs::read(&target).unwrap(), b"newer");
    }
}
