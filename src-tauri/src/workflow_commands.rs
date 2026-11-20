use crate::study_workflows::{self, PromptHandout, PromptLine};
use crate::transcript_import::{self, ImportedSegment};
use serde_json::Value;

#[tauri::command]
pub(crate) async fn parse_transcript_import(text: String) -> Vec<ImportedSegment> {
    transcript_import::parse_import(&text)
}

#[tauri::command]
pub(crate) async fn format_study_context(
    transcript: Vec<PromptLine>,
    handouts: Vec<PromptHandout>,
) -> String {
    study_workflows::format_study_context(transcript, handouts)
}

#[tauri::command]
pub(crate) async fn parse_study_flashcards(
    text: String,
    fenced: bool,
) -> Result<Vec<Value>, &'static str> {
    study_workflows::parse_study_flashcards(text, fenced)
}

#[tauri::command]
pub(crate) async fn valid_study_session_indices(sessions: Vec<Value>) -> Vec<usize> {
    study_workflows::valid_study_session_indices(sessions)
}
