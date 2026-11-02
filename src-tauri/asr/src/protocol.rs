//! Framing between the app and this sidecar over stdin/stdout.
//!
//! Every message is `[u32 little-endian length][u8 kind][payload]`, where `length` counts the kind
//! byte plus the payload. `kind` 1 is a UTF-8 JSON message. Kind 2 (raw f32 PCM) is reserved for
//! live streaming in Phase 2. Frames are size-capped so a corrupt or hostile peer cannot make us
//! allocate unbounded memory.

use std::io::{self, Read, Write};

pub const KIND_JSON: u8 = 1;
/// Raw little-endian f32 PCM, 16 kHz mono (live streaming).
pub const KIND_PCM: u8 = 2;
/// One WAV segment (16 kHz mono) from the recording archive, for the final pass.
pub const KIND_ARCHIVE: u8 = 3;
/// Large enough for any control message or a few seconds of PCM, small enough to bound memory.
pub const MAX_FRAME_BYTES: u32 = 8 * 1024 * 1024;

#[derive(Debug, PartialEq)]
pub struct Frame {
    pub kind: u8,
    pub payload: Vec<u8>,
}

/// Returns `Ok(None)` on a clean end of stream (the app closed stdin).
pub fn read_frame(reader: &mut impl Read) -> io::Result<Option<Frame>> {
    let mut len_bytes = [0u8; 4];
    match reader.read_exact(&mut len_bytes) {
        Ok(()) => {}
        Err(err) if err.kind() == io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(err) => return Err(err),
    }
    let len = u32::from_le_bytes(len_bytes);
    if len == 0 || len > MAX_FRAME_BYTES {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "frame length out of range"));
    }
    let mut kind = [0u8; 1];
    reader.read_exact(&mut kind)?;
    let mut payload = vec![0u8; (len - 1) as usize];
    reader.read_exact(&mut payload)?;
    Ok(Some(Frame { kind: kind[0], payload }))
}

pub fn write_frame(writer: &mut impl Write, kind: u8, payload: &[u8]) -> io::Result<()> {
    let len = u32::try_from(payload.len() + 1)
        .ok()
        .filter(|len| *len <= MAX_FRAME_BYTES)
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "frame too large"))?;
    writer.write_all(&len.to_le_bytes())?;
    writer.write_all(&[kind])?;
    writer.write_all(payload)?;
    writer.flush()
}

pub fn write_json(writer: &mut impl Write, value: &serde_json::Value) -> io::Result<()> {
    write_frame(writer, KIND_JSON, value.to_string().as_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_a_frame() {
        let mut buf = Vec::new();
        write_frame(&mut buf, KIND_JSON, br#"{"type":"hello"}"#).unwrap();
        let frame = read_frame(&mut buf.as_slice()).unwrap().unwrap();
        assert_eq!(frame, Frame { kind: KIND_JSON, payload: br#"{"type":"hello"}"#.to_vec() });
    }

    #[test]
    fn clean_eof_is_none() {
        assert!(read_frame(&mut [].as_slice()).unwrap().is_none());
    }

    #[test]
    fn rejects_oversized_and_empty_frames() {
        let oversized = (MAX_FRAME_BYTES + 1).to_le_bytes();
        assert!(read_frame(&mut oversized.as_slice()).is_err());
        let empty = 0u32.to_le_bytes();
        assert!(read_frame(&mut empty.as_slice()).is_err());
    }

    #[test]
    fn truncated_payload_is_an_error_not_a_hang() {
        let mut buf = Vec::new();
        write_frame(&mut buf, KIND_JSON, b"abcdef").unwrap();
        buf.truncate(buf.len() - 2);
        assert!(read_frame(&mut buf.as_slice()).is_err());
    }
}
