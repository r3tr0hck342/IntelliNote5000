//! On-device transcription: model management and the `intellinote-asr` sidecar.
//! See docs/transcription-phase0-plan.md for the design and threat model.

pub mod archive;
pub mod catalog;
pub mod commands;
pub mod crypto;
pub mod models;
pub mod recording;
pub mod sidecar;
pub mod tier;
