use serde::Deserialize;
use serde_json::Value;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PromptLine {
    text: String,
    is_final: bool,
}

#[derive(Deserialize)]
pub(crate) struct PromptHandout {
    name: String,
    content: String,
}

pub(crate) fn format_study_context(
    transcript: Vec<PromptLine>,
    handouts: Vec<PromptHandout>,
) -> String {
    let text = transcript
        .into_iter()
        .filter(|line| line.is_final)
        .map(|line| line.text)
        .collect::<Vec<_>>()
        .join(" ");
    let mut context = format!("Transcript:\n---\n{text}\n---");
    if !handouts.is_empty() {
        let handouts = handouts
            .into_iter()
            .map(|h| format!("Handout: {}\n---\n{}", h.name, h.content))
            .collect::<Vec<_>>()
            .join("\n\n");
        context.push_str(&format!(
            "\n\nSupplementary Handouts:\n===\n{handouts}\n==="
        ));
    }
    context
}

pub(crate) fn parse_study_flashcards(
    text: String,
    fenced: bool,
) -> Result<Vec<Value>, &'static str> {
    let mut cards: Vec<Value> = if fenced {
        static FENCES: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
        let fences = FENCES.get_or_init(|| regex::Regex::new(r"(?i)```(?:json)?").unwrap());
        let text = fences.replace_all(&text, "");
        let start = text.find('[').ok_or("invalid_flashcards")?;
        let end = text.rfind(']').ok_or("invalid_flashcards")?;
        if end <= start {
            return Err("invalid_flashcards");
        }
        serde_json::from_str(&text[start..=end]).map_err(|_| "invalid_flashcards")?
    } else {
        serde_json::from_str(text.trim_matches(crate::transcript_time::js_space))
            .map_err(|_| "invalid_flashcards")?
    };
    if fenced {
        cards.retain(|card| card["front"].is_string() && card["back"].is_string());
    }
    Ok(cards)
}

fn has_strings(value: &Value, keys: &[&str]) -> bool {
    keys.iter().all(|key| value[key].is_string())
}

fn valid_segment(segment: &Value) -> bool {
    has_strings(segment, &["id", "assetId", "text", "createdAt"])
        && segment["startMs"].is_number()
        && segment["endMs"].is_number()
        && segment["isFinal"].is_boolean()
}

fn valid_asset(asset: &Value) -> bool {
    has_strings(
        asset,
        &["id", "sessionId", "transcriptText", "language", "createdAt"],
    ) && matches!(asset["sourceType"].as_str(), Some("live" | "import"))
        && asset["segments"]
            .as_array()
            .is_some_and(|items| items.iter().all(valid_segment))
}

fn valid_session(session: &Value) -> bool {
    has_strings(session, &["id", "title", "topic", "createdAt", "updatedAt"])
        && session["assets"]
            .as_array()
            .is_some_and(|items| items.iter().all(valid_asset))
        && ["handouts", "tags", "chatHistory"]
            .iter()
            .all(|key| session[key].is_array())
}

pub(crate) fn valid_study_session_indices(sessions: Vec<Value>) -> Vec<usize> {
    sessions
        .iter()
        .enumerate()
        .filter_map(|(index, session)| valid_session(session).then_some(index))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn builds_context_and_handles_provider_flashcards() {
        let context = format_study_context(
            vec![
                PromptLine {
                    text: "final".into(),
                    is_final: true,
                },
                PromptLine {
                    text: "interim".into(),
                    is_final: false,
                },
            ],
            vec![PromptHandout {
                name: "Topic".into(),
                content: "Details".into(),
            }],
        );
        assert_eq!(
            context,
            "Transcript:\n---\nfinal\n---\n\nSupplementary Handouts:\n===\nHandout: Topic\n---\nDetails\n==="
        );

        let fenced = "Text\n```JSON\n[{\"front\":\"Q\",\"back\":\"A\"},{\"front\":1}]\n```";
        assert_eq!(
            parse_study_flashcards(fenced.into(), true).unwrap(),
            vec![json!({"front": "Q", "back": "A"})]
        );
        assert!(parse_study_flashcards("] [".into(), true).is_err());
        assert!(
            parse_study_flashcards("[]".into(), false)
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn accepts_older_saved_sessions_and_ignores_invalid_rows() {
        let session = json!({
            "id": "lecture", "title": "Biology", "topic": "", "createdAt": "", "updatedAt": "",
            "assets": [{
                "id": "asset", "sessionId": "lecture", "sourceType": "live", "transcriptText": "text",
                "language": "en-US", "createdAt": "", "segments": [{
                    "id": "segment", "assetId": "asset", "text": "text", "createdAt": "",
                    "startMs": 0, "endMs": 1000, "isFinal": true
                }]
            }],
            "handouts": [], "tags": [], "chatHistory": []
        });
        let sessions = vec![Value::Null, session];
        assert_eq!(valid_study_session_indices(sessions), vec![1]);
    }
}
