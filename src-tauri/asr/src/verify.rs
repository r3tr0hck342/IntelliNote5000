//! Model files are untrusted native-parser input: each one is hashed and compared with the pinned
//! SHA-256 immediately before it is handed to ONNX Runtime. A mismatch refuses the load.

use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::fs::File;
use std::io::{self, Read};

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PinnedFile {
    pub path: String,
    pub sha256: String,
}

pub fn sha256_file(path: &str) -> io::Result<String> {
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

#[derive(Debug, PartialEq)]
pub enum VerifyError {
    /// The file could not be read. The path is deliberately not included (no paths in logs).
    Unreadable,
    Mismatch,
}

pub fn verify(file: &PinnedFile) -> Result<(), VerifyError> {
    let actual = sha256_file(&file.path).map_err(|_| VerifyError::Unreadable)?;
    if actual.eq_ignore_ascii_case(file.sha256.trim()) {
        Ok(())
    } else {
        Err(VerifyError::Mismatch)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn temp_file(name: &str, contents: &[u8]) -> String {
        let path = std::env::temp_dir().join(format!("intellinote-asr-test-{}-{name}", std::process::id()));
        File::create(&path).unwrap().write_all(contents).unwrap();
        path.to_string_lossy().into_owned()
    }

    #[test]
    fn hashes_known_input() {
        // Standard SHA-256 test vector for "abc" (FIPS 180-2, appendix B.1).
        let path = temp_file("abc", b"abc");
        assert_eq!(
            sha256_file(&path).unwrap(),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn accepts_matching_hash_case_insensitively() {
        let path = temp_file("good", b"model");
        let expected = sha256_file(&path).unwrap();
        assert_eq!(verify(&PinnedFile { path, sha256: expected.to_uppercase() }), Ok(()));
    }

    #[test]
    fn rejects_tampered_file() {
        let path = temp_file("tampered", b"model");
        let good = sha256_file(&path).unwrap();
        File::create(&path).unwrap().write_all(b"model!").unwrap(); // one byte appended
        assert_eq!(verify(&PinnedFile { path, sha256: good }), Err(VerifyError::Mismatch));
    }

    #[test]
    fn missing_file_is_unreadable() {
        let pinned = PinnedFile { path: "/nonexistent/intellinote/model.onnx".into(), sha256: "00".into() };
        assert_eq!(verify(&pinned), Err(VerifyError::Unreadable));
    }
}
