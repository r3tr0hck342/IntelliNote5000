//! Client for the `intellinote-asr` sidecar. The recognizer runs in its own process so a crash in
//! ONNX Runtime or a media decoder cannot take the app (and, from Phase 2, the audio archive) down.
//!
//! Framing mirrors src-tauri/asr/src/protocol.rs: `[u32 LE length][u8 kind][payload]`. It is
//! duplicated rather than shared because sharing would pull sherpa-onnx into the app's build.

use serde_json::Value;
use std::io::{self, BufReader, Read, Write};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::time::Duration;

/// The sidecar reports progress every ~5 s of audio; this long a silence means it is hung.
const INACTIVITY_TIMEOUT: Duration = Duration::from_secs(180);

const KIND_JSON: u8 = 1;
const MAX_FRAME_BYTES: u32 = 64 * 1024 * 1024; // results for a long lecture can be several MB

/// Tauri bundles `externalBin` sidecars next to the main executable on every platform.
pub fn sidecar_path() -> io::Result<PathBuf> {
    // Tests run from target/*/deps, where no sidecar is bundled.
    #[cfg(test)]
    if let Some(path) = std::env::var_os("INTELLINOTE_ASR_BIN") {
        return Ok(PathBuf::from(path));
    }
    let exe = std::env::current_exe()?;
    let dir = exe.parent().ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "no exe dir"))?;
    Ok(dir.join(format!("intellinote-asr{}", std::env::consts::EXE_SUFFIX)))
}

pub fn write_frame(writer: &mut (impl Write + ?Sized), value: &Value) -> io::Result<()> {
    let body = value.to_string().into_bytes();
    let len = u32::try_from(body.len() + 1).map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "frame too large"))?;
    writer.write_all(&len.to_le_bytes())?;
    writer.write_all(&[KIND_JSON])?;
    writer.write_all(&body)?;
    writer.flush()
}

pub fn read_frame(reader: &mut impl Read) -> io::Result<Option<Value>> {
    let mut len = [0u8; 4];
    match reader.read_exact(&mut len) {
        Ok(()) => {}
        Err(err) if err.kind() == io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(err) => return Err(err),
    }
    let len = u32::from_le_bytes(len);
    if len == 0 || len > MAX_FRAME_BYTES {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "frame length out of range"));
    }
    let mut buf = vec![0u8; len as usize];
    reader.read_exact(&mut buf)?;
    if buf[0] != KIND_JSON {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "unexpected frame kind"));
    }
    serde_json::from_slice(&buf[1..]).map(Some).map_err(|err| io::Error::new(io::ErrorKind::InvalidData, err))
}

/// Writes a raw frame (e.g. kind 3: one WAV archive segment).
pub fn write_raw_frame(writer: &mut (impl Write + ?Sized), kind: u8, payload: &[u8]) -> io::Result<()> {
    let len = u32::try_from(payload.len() + 1).map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "frame too large"))?;
    writer.write_all(&len.to_le_bytes())?;
    writer.write_all(&[kind])?;
    writer.write_all(payload)?;
    writer.flush()
}

/// Runs one request to completion in a fresh sidecar process. Status and progress events go to
/// `on_event`; the `result` payload is returned. Errors are short codes, never paths or text.
pub fn run(request: &Value, on_event: impl FnMut(&Value)) -> Result<Value, String> {
    run_with_feed(request, |_| Ok(()), on_event)
}

/// Like `run`, but `feed` streams extra frames after the request. It runs on its own thread so
/// that writing audio and reading progress events can never deadlock on full pipes.
pub fn run_with_feed(
    request: &Value,
    feed: impl FnOnce(&mut dyn Write) -> io::Result<()> + Send + 'static,
    mut on_event: impl FnMut(&Value),
) -> Result<Value, String> {
    let mut child = Command::new(sidecar_path().map_err(|_| "sidecar_missing")?)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| "sidecar_missing".to_string())?;
    let result = (|| {
        let mut stdin = std::io::BufWriter::new(child.stdin.take().ok_or("sidecar_io")?);
        write_frame(&mut stdin, request).map_err(|_| "sidecar_io")?;
        // One request per process; closing stdin after the feed makes the sidecar exit when done.
        std::thread::spawn(move || {
            let _ = feed(&mut stdin);
            let _ = stdin.flush();
        });
        // Frames are read on a helper thread so a hung sidecar can be detected and killed.
        let mut stdout = BufReader::new(child.stdout.take().ok_or("sidecar_io")?);
        let (sender, receiver) = mpsc::channel();
        std::thread::spawn(move || loop {
            let frame = read_frame(&mut stdout);
            let finished = !matches!(frame, Ok(Some(_)));
            if sender.send(frame).is_err() || finished {
                break;
            }
        });
        loop {
            match receiver.recv_timeout(INACTIVITY_TIMEOUT) {
                Ok(Ok(Some(message))) => match message["type"].as_str() {
                    Some("result") => return Ok(message["transcript"].clone()),
                    Some("error") => return Err(message["code"].as_str().unwrap_or("sidecar_error").to_string()),
                    _ => on_event(&message),
                },
                Ok(Ok(None)) => return Err("sidecar_exited".to_string()),
                Ok(Err(_)) => return Err("sidecar_protocol_error".to_string()),
                Err(_) => return Err("sidecar_timeout".to_string()),
            }
        }
    })();
    if result.is_err() {
        let _ = child.kill();
    }
    let _ = child.wait();
    result
}

/// Finds `ffmpeg` on PATH. Used only as a fallback for formats symphonia cannot decode (Opus).
pub fn find_ffmpeg() -> Option<PathBuf> {
    let name = format!("ffmpeg{}", std::env::consts::EXE_SUFFIX);
    std::env::split_paths(&std::env::var_os("PATH")?).map(|dir| dir.join(&name)).find(|path| path.is_file())
}

/// Converts any media file to 16 kHz mono WAV with explicit arguments and no shell.
/// `-protocol_whitelist file` stops playlist-style inputs (HLS, concat) from reaching other files'
/// URLs or the network; `output` must already exist (created exclusively by the caller).
pub fn ffmpeg_to_wav(ffmpeg: &PathBuf, input: &PathBuf, output: &PathBuf) -> Result<(), String> {
    if !input.is_absolute() {
        return Err("ffmpeg_failed".to_string());
    }
    let status = Command::new(ffmpeg)
        .args(["-nostdin", "-hide_banner", "-loglevel", "error", "-protocol_whitelist", "file", "-y", "-i"])
        .arg(input)
        .args(["-vn", "-ac", "1", "-ar", "16000", "-f", "wav"])
        .arg(output)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(|_| "ffmpeg_failed".to_string())?;
    if status.success() {
        Ok(())
    } else {
        Err("ffmpeg_failed".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn frames_round_trip_and_match_the_sidecar_layout() {
        let mut buf = Vec::new();
        write_frame(&mut buf, &json!({ "type": "hello" })).unwrap();
        assert_eq!(&buf[..4], &((buf.len() - 4) as u32).to_le_bytes());
        assert_eq!(buf[4], KIND_JSON);
        assert_eq!(read_frame(&mut buf.as_slice()).unwrap(), Some(json!({ "type": "hello" })));
        assert_eq!(read_frame(&mut [].as_slice()).unwrap(), None);
    }

    #[test]
    fn rejects_oversized_frames() {
        let header = (MAX_FRAME_BYTES + 1).to_le_bytes();
        assert!(read_frame(&mut header.as_slice()).is_err());
    }
}
