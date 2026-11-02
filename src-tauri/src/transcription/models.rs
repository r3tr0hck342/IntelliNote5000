//! Model download and installation.
//!
//! - Resumable: a partial download is kept and continued with an HTTP Range request.
//! - Verified twice: the archive against GitHub's published digest, then every extracted file
//!   against its pinned hash. The sidecar verifies again right before loading.
//! - Extraction is a whitelist: only the exact `<archiveRoot>/<name>` regular files listed in the
//!   catalog are written, so path traversal and symlink entries are never followed.
//! - Atomic: files land in a staging directory that is renamed into place only after every hash
//!   matches, so a crash or failed check never leaves a half-installed model.

use super::catalog::ModelEntry;
use sha2::{Digest, Sha256};
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};

/// Extraction limits: the archive hash is pinned, so these only matter if an upstream release
/// were compromised, but a decompression bomb should fail fast rather than fill the disk.
const MAX_ARCHIVE_ENTRIES: usize = 1_000;
const MAX_ENTRY_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const MAX_TOTAL_BYTES: u64 = 4 * 1024 * 1024 * 1024;

#[derive(Debug, PartialEq)]
pub enum ModelError {
    Network,
    HttpStatus(u16),
    /// Server sent more bytes than the pinned size, or a mismatched resume range.
    UnexpectedSize,
    /// Archive exceeds extraction limits.
    ArchiveTooLarge,
    ArchiveHashMismatch,
    FileHashMismatch,
    MissingFile,
    Io,
}

impl ModelError {
    pub fn code(&self) -> String {
        match self {
            ModelError::Network => "network_error".into(),
            ModelError::HttpStatus(status) => format!("http_{status}"),
            ModelError::UnexpectedSize => "unexpected_size".into(),
            ModelError::ArchiveTooLarge => "archive_too_large".into(),
            ModelError::ArchiveHashMismatch => "archive_hash_mismatch".into(),
            ModelError::FileHashMismatch => "file_hash_mismatch".into(),
            ModelError::MissingFile => "missing_file".into(),
            ModelError::Io => "io_error".into(),
        }
    }
}

impl From<io::Error> for ModelError {
    fn from(_: io::Error) -> Self {
        ModelError::Io
    }
}

pub fn install_dir(models_dir: &Path, id: &str) -> PathBuf {
    models_dir.join(id)
}

pub fn file_path(models_dir: &Path, id: &str, name: &str) -> PathBuf {
    install_dir(models_dir, id).join(name)
}

/// Cheap presence check; full hashes are verified at install time and again before every load.
pub fn is_installed(models_dir: &Path, id: &str, entry: &ModelEntry) -> bool {
    entry.files.values().all(|file| {
        fs::metadata(file_path(models_dir, id, &file.name)).map(|meta| meta.is_file() && meta.len() > 0).unwrap_or(false)
    })
}

pub fn sha256_file(path: &Path) -> io::Result<String> {
    let mut file = File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 1 << 20];
    loop {
        let read = file.read(&mut buf)?;
        if read == 0 {
            break;
        }
        hasher.update(&buf[..read]);
    }
    Ok(hasher.finalize().iter().map(|byte| format!("{byte:02x}")).collect())
}

fn partial_path(models_dir: &Path, id: &str) -> PathBuf {
    models_dir.join(".downloads").join(format!("{id}.partial"))
}

/// Downloads (resuming if possible) and installs one model. `progress(done, total)` is called as
/// bytes arrive.
pub async fn download_and_install(
    models_dir: &Path,
    id: &str,
    entry: &ModelEntry,
    mut progress: impl FnMut(u64, u64),
) -> Result<(), ModelError> {
    let partial = partial_path(models_dir, id);
    fs::create_dir_all(partial.parent().expect("partial has a parent"))?;
    restrict_to_owner(models_dir);
    let mut done = fs::metadata(&partial).map(|meta| meta.len()).unwrap_or(0);
    if done > entry.archive_bytes {
        fs::remove_file(&partial)?;
        done = 0;
    }

    if done < entry.archive_bytes {
        let client = reqwest::Client::new();
        let mut request = client.get(&entry.url);
        if done > 0 {
            request = request.header(reqwest::header::RANGE, format!("bytes={done}-"));
        }
        let mut response = request.send().await.map_err(|_| ModelError::Network)?;
        let status = response.status();
        if !status.is_success() {
            return Err(ModelError::HttpStatus(status.as_u16()));
        }
        // A server that ignores Range answers 200 with the whole file: start over.
        let resuming = status == reqwest::StatusCode::PARTIAL_CONTENT;
        if resuming {
            let range = response
                .headers()
                .get(reqwest::header::CONTENT_RANGE)
                .and_then(|value| value.to_str().ok())
                .unwrap_or("");
            if !range.starts_with(&format!("bytes {done}-")) {
                return Err(ModelError::UnexpectedSize);
            }
        } else {
            done = 0;
        }
        let mut file = OpenOptions::new().create(true).write(true).append(resuming).truncate(!resuming).open(&partial)?;
        while let Some(chunk) = response.chunk().await.map_err(|_| ModelError::Network)? {
            // Never write past the pinned size, whatever the server sends.
            if done + chunk.len() as u64 > entry.archive_bytes {
                drop(file);
                let _ = fs::remove_file(&partial);
                return Err(ModelError::UnexpectedSize);
            }
            file.write_all(&chunk)?;
            done += chunk.len() as u64;
            progress(done, entry.archive_bytes);
        }
        file.sync_all()?;
    }

    let partial_for_install = partial.clone();
    let models_dir = models_dir.to_path_buf();
    let id = id.to_string();
    let entry = entry.clone();
    tauri::async_runtime::spawn_blocking(move || -> Result<(), ModelError> {
        if !sha256_file(&partial_for_install)?.eq_ignore_ascii_case(&entry.archive_sha256) {
            let _ = fs::remove_file(&partial_for_install);
            return Err(ModelError::ArchiveHashMismatch);
        }
        install_from_archive(&partial_for_install, &models_dir, &id, &entry)?;
        let _ = fs::remove_file(&partial_for_install);
        Ok(())
    })
    .await
    .map_err(|_| ModelError::Io)?
}

/// Extracts (whitelist only), verifies, and atomically installs a downloaded archive.
pub fn install_from_archive(archive: &Path, models_dir: &Path, id: &str, entry: &ModelEntry) -> Result<(), ModelError> {
    let staging = models_dir.join(format!(".staging-{id}"));
    if staging.exists() {
        fs::remove_dir_all(&staging)?;
    }
    fs::create_dir_all(&staging)?;

    let result = (|| -> Result<(), ModelError> {
        match &entry.archive_root {
            None => {
                // Single-file model: the download is the file itself.
                let file = entry.files.values().next().ok_or(ModelError::MissingFile)?;
                fs::copy(archive, staging.join(&file.name))?;
            }
            Some(root) => {
                let wanted: Vec<(PathBuf, &str)> = entry
                    .files
                    .values()
                    .map(|file| (Path::new(root).join(&file.name), file.name.as_str()))
                    .collect();
                let mut tar = tar::Archive::new(bzip2::read::BzDecoder::new(File::open(archive)?));
                let mut total: u64 = 0;
                for (index, item) in tar.entries()?.enumerate() {
                    let mut item = item?;
                    let size = item.header().size()?;
                    total = total.saturating_add(size);
                    if index >= MAX_ARCHIVE_ENTRIES || size > MAX_ENTRY_BYTES || total > MAX_TOTAL_BYTES {
                        return Err(ModelError::ArchiveTooLarge);
                    }
                    if !item.header().entry_type().is_file() {
                        continue; // directories, symlinks, hard links: never followed or created
                    }
                    let path = item.path()?.into_owned();
                    if let Some((_, name)) = wanted.iter().find(|(want, _)| *want == path) {
                        let mut out = File::create(staging.join(name))?;
                        io::copy(&mut (&mut item).take(MAX_ENTRY_BYTES), &mut out)?;
                        out.sync_all()?;
                    }
                }
            }
        }
        for file in entry.files.values() {
            let staged = staging.join(&file.name);
            if !staged.is_file() {
                return Err(ModelError::MissingFile);
            }
            if !sha256_file(&staged)?.eq_ignore_ascii_case(&file.sha256) {
                return Err(ModelError::FileHashMismatch);
            }
        }
        // Move any old install aside before the rename, so a crash leaves either the old or the
        // new install in place (and the sidecar re-verifies hashes at load either way).
        let target = install_dir(models_dir, id);
        let previous = models_dir.join(format!(".previous-{id}"));
        if previous.exists() {
            fs::remove_dir_all(&previous)?;
        }
        if target.exists() {
            fs::rename(&target, &previous)?;
        }
        fs::rename(&staging, &target)?;
        let _ = fs::remove_dir_all(&previous);
        Ok(())
    })();

    if result.is_err() {
        let _ = fs::remove_dir_all(&staging);
    }
    result
}

/// Models are executable-adjacent input; keep the directory private to the user (Unix only).
fn restrict_to_owner(dir: &Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(dir, fs::Permissions::from_mode(0o700));
    }
    #[cfg(not(unix))]
    let _ = dir;
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::transcription::catalog::FileEntry;
    use std::collections::BTreeMap;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("intellinote-models-test-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn sha(bytes: &[u8]) -> String {
        Sha256::digest(bytes).iter().map(|b| format!("{b:02x}")).collect()
    }

    fn entry(files: &[(&str, &[u8])]) -> ModelEntry {
        ModelEntry {
            role: "test".into(),
            license: "MIT".into(),
            attribution: "test".into(),
            url: "https://example.invalid".into(),
            archive_bytes: 0,
            archive_sha256: String::new(),
            archive_root: Some("root".into()),
            files: files
                .iter()
                .map(|(name, bytes)| (name.to_string(), FileEntry { name: name.to_string(), sha256: sha(bytes) }))
                .collect::<BTreeMap<_, _>>(),
        }
    }

    /// Writes raw tar headers so tests can include entries `tar::Builder` refuses to create.
    fn write_archive(path: &Path, entries: &[(&str, tar::EntryType, &[u8])]) {
        let encoder = bzip2::write::BzEncoder::new(File::create(path).unwrap(), bzip2::Compression::fast());
        let mut builder = tar::Builder::new(encoder);
        for (name, kind, data) in entries {
            let mut header = tar::Header::new_gnu();
            let raw = &mut header.as_old_mut().name;
            raw[..name.len()].copy_from_slice(name.as_bytes());
            header.set_entry_type(*kind);
            header.set_size(data.len() as u64);
            header.set_mode(0o644);
            if *kind == tar::EntryType::Symlink {
                header.set_link_name("/etc/passwd").unwrap();
            }
            header.set_cksum();
            builder.append(&header, *data).unwrap();
        }
        builder.into_inner().unwrap().finish().unwrap();
    }

    #[test]
    fn installs_only_whitelisted_files_and_verifies_them() {
        let dir = temp_dir("good");
        let archive = dir.join("model.tar.bz2");
        write_archive(
            &archive,
            &[
                ("root/model.onnx", tar::EntryType::Regular, b"weights"),
                ("root/../../escape.txt", tar::EntryType::Regular, b"evil"),
                ("root/extra.txt", tar::EntryType::Regular, b"not in catalog"),
            ],
        );
        let models = dir.join("models");
        let model = entry(&[("model.onnx", b"weights")]);
        install_from_archive(&archive, &models, "m", &model).unwrap();
        assert_eq!(fs::read(file_path(&models, "m", "model.onnx")).unwrap(), b"weights");
        assert!(!file_path(&models, "m", "extra.txt").exists());
        assert!(!dir.join("escape.txt").exists() && !models.join("escape.txt").exists());
        assert!(is_installed(&models, "m", &model));
        assert!(!models.join(".staging-m").exists(), "staging is renamed away");
    }

    #[test]
    fn tampered_file_is_rejected_and_nothing_is_installed() {
        let dir = temp_dir("tampered");
        let archive = dir.join("model.tar.bz2");
        write_archive(&archive, &[("root/model.onnx", tar::EntryType::Regular, b"weights-tampered")]);
        let models = dir.join("models");
        let model = entry(&[("model.onnx", b"weights")]);
        assert_eq!(install_from_archive(&archive, &models, "m", &model), Err(ModelError::FileHashMismatch));
        assert!(!install_dir(&models, "m").exists());
        assert!(!models.join(".staging-m").exists());
    }

    #[test]
    fn symlink_entries_are_never_followed() {
        let dir = temp_dir("symlink");
        let archive = dir.join("model.tar.bz2");
        write_archive(&archive, &[("root/model.onnx", tar::EntryType::Symlink, b"")]);
        let models = dir.join("models");
        let model = entry(&[("model.onnx", b"weights")]);
        assert_eq!(install_from_archive(&archive, &models, "m", &model), Err(ModelError::MissingFile));
        assert!(!install_dir(&models, "m").exists());
    }

    #[test]
    fn single_file_models_install_from_the_download_itself() {
        let dir = temp_dir("single");
        let download = dir.join("vad.partial");
        fs::write(&download, b"vad").unwrap();
        let models = dir.join("models");
        let mut model = entry(&[("silero_vad.onnx", b"vad")]);
        model.archive_root = None;
        install_from_archive(&download, &models, "vad", &model).unwrap();
        assert!(is_installed(&models, "vad", &model));
    }

    #[test]
    fn archives_over_the_entry_limit_are_rejected() {
        let dir = temp_dir("bomb");
        let archive = dir.join("model.tar.bz2");
        let names: Vec<String> = (0..=MAX_ARCHIVE_ENTRIES).map(|i| format!("root/filler-{i}")).collect();
        let entries: Vec<(&str, tar::EntryType, &[u8])> =
            names.iter().map(|name| (name.as_str(), tar::EntryType::Regular, &b""[..])).collect();
        write_archive(&archive, &entries);
        let models = dir.join("models");
        let model = entry(&[("model.onnx", b"weights")]);
        assert_eq!(install_from_archive(&archive, &models, "m", &model), Err(ModelError::ArchiveTooLarge));
        assert!(!install_dir(&models, "m").exists());
    }

    #[test]
    fn reinstall_replaces_a_previous_install_atomically() {
        let dir = temp_dir("reinstall");
        let models = dir.join("models");
        let model = entry(&[("model.onnx", b"weights")]);
        let archive = dir.join("model.tar.bz2");
        write_archive(&archive, &[("root/model.onnx", tar::EntryType::Regular, b"weights")]);
        install_from_archive(&archive, &models, "m", &model).unwrap();
        fs::write(file_path(&models, "m", "stale.txt"), b"old").unwrap();
        install_from_archive(&archive, &models, "m", &model).unwrap();
        assert!(!file_path(&models, "m", "stale.txt").exists());
        assert!(!models.join(".previous-m").exists(), "previous install is cleaned up");
    }
}
