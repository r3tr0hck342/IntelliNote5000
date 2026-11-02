//! The pinned model catalog (src-tauri/transcription-models.json), embedded at compile time so the
//! hashes the app trusts cannot be changed without a rebuild.

use serde::Deserialize;
use std::collections::BTreeMap;
use std::sync::OnceLock;

const CATALOG_JSON: &str = include_str!("../../transcription-models.json");

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Catalog {
    pub sherpa_onnx_version: String,
    pub models: BTreeMap<String, ModelEntry>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelEntry {
    pub role: String,
    pub license: String,
    pub attribution: String,
    pub url: String,
    pub archive_bytes: u64,
    pub archive_sha256: String,
    /// Directory inside the `.tar.bz2`; `None` means the download is the model file itself.
    pub archive_root: Option<String>,
    pub files: BTreeMap<String, FileEntry>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct FileEntry {
    pub name: String,
    pub sha256: String,
}

pub fn catalog() -> &'static Catalog {
    static CATALOG: OnceLock<Catalog> = OnceLock::new();
    CATALOG.get_or_init(|| serde_json::from_str(CATALOG_JSON).expect("transcription-models.json is valid"))
}

pub fn model(id: &str) -> Option<&'static ModelEntry> {
    catalog().models.get(id)
}

pub const PARAKEET_ID: &str = "parakeet-tdt-0.6b-v3-int8";
pub const VAD_ID: &str = "silero-vad";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_parses_and_pins_everything() {
        let catalog = catalog();
        assert_eq!(catalog.sherpa_onnx_version, "2.0.1");
        for (id, model) in &catalog.models {
            assert!(model.url.starts_with("https://github.com/k2-fsa/sherpa-onnx/releases/download/"), "{id}");
            assert_eq!(model.archive_sha256.len(), 64, "{id}");
            assert!(!model.files.is_empty(), "{id}");
            for file in model.files.values() {
                assert_eq!(file.sha256.len(), 64, "{id}/{}", file.name);
                assert!(!file.name.contains('/') && !file.name.contains(".."), "{id}/{}", file.name);
            }
        }
        assert!(model(PARAKEET_ID).is_some() && model(VAD_ID).is_some());
    }
}
