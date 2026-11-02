//! Always-on recording archive, independent of transcription.
//!
//! Audio is written as 15 s FLAC segments (16 kHz mono), each encrypted, written to `.partial`,
//! fsynced, then atomically renamed. `manifest.json` is rewritten the same way after every segment.
//! A crash loses at most the segment in progress; a transcription failure loses nothing.

use super::crypto::RecordingKey;
use flacenc::bitsink::ByteSink;
use flacenc::component::BitRepr;
use flacenc::error::Verify;
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

pub fn encode_flac(samples: &[f32]) -> Result<Vec<u8>, String> {
    let ints: Vec<i32> = samples.iter().map(|s| (s.clamp(-1.0, 1.0) * i16::MAX as f32) as i32).collect();
    let config = flacenc::config::Encoder::default().into_verified().map_err(|_| "flac_config")?;
    let source = flacenc::source::MemSource::from_samples(&ints, 1, 16, SAMPLE_RATE);
    let stream = flacenc::encode_with_fixed_block_size(&config, source, config.block_size).map_err(|_| "flac_encode")?;
    let mut sink = ByteSink::new();
    stream.write(&mut sink).map_err(|_| "flac_write")?;
    Ok(sink.as_slice().to_vec())
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
        let flac = encode_flac(samples).map_err(|code| io::Error::new(io::ErrorKind::Other, code))?;
        let name = format!("seg-{:06}.flac.enc", self.manifest.segments.len());
        write_atomic(&self.dir.join(&name), &self.key.encrypt(&flac))?;
        self.manifest.segments.push(SegmentEntry { file: name, samples: samples.len() as u64 });
        self.manifest.total_samples += samples.len() as u64;
        self.write_manifest()
    }

    fn write_manifest(&self) -> io::Result<()> {
        let json = serde_json::to_vec_pretty(&self.manifest).map_err(io::Error::other)?;
        write_atomic(&self.dir.join("manifest.json"), &json)
    }
}

#[allow(dead_code)] // read back by the final pass (Phase 3)
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
        assert_ne!(&sealed[..4], b"fLaC", "segments are not stored in the clear");
        assert_eq!(&key.decrypt(&sealed).unwrap()[..4], b"fLaC", "decrypts to a FLAC stream");
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
