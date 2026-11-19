use regex::Regex;
use serde::Serialize;
use std::sync::OnceLock;

use crate::transcript_time::{js_space, parse_timestamp};

const TIME: &str = r"(?:[0-9]{1,2}:)?[0-9]{2}:[0-9]{2}(?:[.,][0-9]{1,3})?";
const INLINE_TIME: &str = r"^\[?([0-9]{1,2}:[0-9]{2}:[0-9]{2}(?:[.,][0-9]{1,3})?|[0-9]{1,2}:[0-9]{2}(?:[.,][0-9]{1,3})?)\]? *(.*)$";
static CUE: OnceLock<Regex> = OnceLock::new();
static INLINE: OnceLock<Regex> = OnceLock::new();

fn normalize(line: &str) -> String {
    line.split(js_space)
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ImportedSegment {
    text: String,
    start_ms: u32,
    end_ms: u32,
}

fn segment(text: String, start_ms: u32, end_ms: u32) -> ImportedSegment {
    ImportedSegment {
        text,
        start_ms,
        end_ms,
    }
}

pub(crate) fn parse_import(text: &str) -> Vec<ImportedSegment> {
    let text = text.replace("\r\n", "\n").replace('\r', "\n");
    let mut lines: Vec<_> = text.split('\n').map(normalize).collect();
    lines.dedup_by(|next, previous| next.is_empty() && previous.is_empty());
    let cue = CUE.get_or_init(|| Regex::new(&format!(r"^({TIME}) *--> *({TIME})")).unwrap());
    let mut cues = Vec::new();
    let mut lines_iter = lines.iter();
    while let Some(line) = lines_iter.next() {
        if let Some(parts) = cue.captures(line) {
            let body = lines_iter
                .by_ref()
                .take_while(|line| !line.is_empty())
                .map(String::as_str)
                .collect::<Vec<_>>()
                .join(" ");
            if !body.is_empty() {
                cues.push(segment(
                    body,
                    parse_timestamp(&parts[1]).unwrap_or(0),
                    parse_timestamp(&parts[2]).unwrap_or(0),
                ));
            }
        }
    }
    if !cues.is_empty() {
        return cues;
    }

    let inline_time = INLINE.get_or_init(|| Regex::new(INLINE_TIME).unwrap());
    let mut inline = Vec::new();
    let mut current: Option<ImportedSegment> = None;
    let mut has_body_line = false;
    let mut has_timestamp = false;
    let first = lines
        .iter()
        .position(|line| !line.is_empty())
        .unwrap_or(lines.len());
    let end = lines
        .iter()
        .rposition(|line| !line.is_empty())
        .map_or(first, |index| index + 1);
    for line in &lines[first..end] {
        let timestamped = inline_time.captures(line).and_then(|parts| {
            let start = parse_timestamp(&parts[1])?;
            let body = parts.get(2)?.as_str();
            Some((start, body))
        });
        if let Some((start, body)) = timestamped {
            if let Some(previous) = current.take().filter(|_| has_body_line) {
                inline.push(previous);
            }
            has_timestamp = true;
            has_body_line = !body.is_empty();
            current = Some(segment(body.into(), start, start));
            continue;
        }
        if let Some(current) = &mut current {
            has_body_line = true;
            if !line.is_empty() {
                if !current.text.is_empty() {
                    current.text.push(' ');
                }
                current.text.push_str(line);
            }
        } else if !line.is_empty() {
            inline.push(segment(line.clone(), 0, 0));
        }
    }
    if let Some(last) = current.filter(|_| has_body_line) {
        inline.push(last);
    }
    if has_timestamp && !inline.is_empty() {
        for index in 1..inline.len() {
            inline[index - 1].end_ms = inline[index].start_ms;
        }
        return inline;
    }

    lines
        .split(|line| line.is_empty())
        .filter(|paragraph| !paragraph.is_empty())
        .flat_map(|paragraph| {
            let text = paragraph.join(" ");
            let mut sentences = Vec::new();
            if text.encode_utf16().count() > 400 {
                let mut start = 0;
                for (index, _) in text.match_indices(' ') {
                    if text[..index].ends_with(['.', '!', '?']) {
                        sentences.push(segment(text[start..index].into(), 0, 0));
                        start = index + 1;
                    }
                }
                sentences.push(segment(text[start..].into(), 0, 0));
            } else {
                sentences.push(segment(text, 0, 0));
            }
            sentences
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_plain_text_and_cues() {
        assert_eq!(
            parse_import("\u{feff}First\tline\r\n\r\nSecond line"),
            vec![
                segment("First line".into(), 0, 0),
                segment("Second line".into(), 0, 0)
            ]
        );
        assert_eq!(
            parse_import("WEBVTT\n\n00:12.345 --> 00:15.678 align:start\nHello VTT\nSecond line"),
            vec![segment("Hello VTT Second line".into(), 12345, 15678)]
        );
        assert_eq!(
            parse_import(
                "1\n00:00:01,200 --> 00:00:03,900\nHello SRT\n\n2\n00:04.0 --> 00:05.5\nNext"
            ),
            vec![
                segment("Hello SRT".into(), 1200, 3900),
                segment("Next".into(), 4000, 5500)
            ]
        );
        assert_eq!(
            parse_import("[00:00:01] First line\n[00:00:05] Second line"),
            vec![
                segment("First line".into(), 1000, 5000),
                segment("Second line".into(), 5000, 5000)
            ]
        );
        assert!(parse_import("\u{feff}\t\n").is_empty());
    }

    #[test]
    fn measures_sentence_threshold_in_utf16() {
        let first = format!("{}.", "😀".repeat(200));
        assert_eq!(
            parse_import(&format!("{first} Last.")),
            vec![segment(first, 0, 0), segment("Last.".into(), 0, 0)]
        );
    }
}
