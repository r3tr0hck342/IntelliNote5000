//! Encryption at rest for recordings: AES-256-GCM with a per-install key kept in the OS keychain
//! (same `keyring` service as the API keys). File layout: `INA1` magic | 12-byte nonce | ciphertext+tag.

use aes_gcm::aead::{Aead, KeyInit, OsRng};
use aes_gcm::{AeadCore, Aes256Gcm, Key, Nonce};
use keyring::Entry;

const SERVICE_NAME: &str = "IntelliNoteSecureConfig";
const KEY_ACCOUNT: &str = "recording_key";
const MAGIC: &[u8; 4] = b"INA1";
const NONCE_LEN: usize = 12;

#[derive(Clone)]
pub struct RecordingKey(Key<Aes256Gcm>);

#[derive(Debug, PartialEq)]
pub enum CryptoError {
    Keychain,
    Malformed,
    /// Wrong key or tampered/corrupted file (GCM tag mismatch).
    Authentication,
}

impl RecordingKey {
    #[cfg(test)]
    pub fn for_tests(byte: u8) -> Self {
        Self(*Key::<Aes256Gcm>::from_slice(&[byte; 32]))
    }

    /// Loads the install's key from the keychain, creating it on first use.
    pub fn load_or_create() -> Result<Self, CryptoError> {
        let entry = Entry::new(SERVICE_NAME, KEY_ACCOUNT).map_err(|_| CryptoError::Keychain)?;
        match entry.get_password() {
            Ok(hex) => decode_hex(&hex).map(|bytes| Self(*Key::<Aes256Gcm>::from_slice(&bytes))).ok_or(CryptoError::Keychain),
            Err(keyring::Error::NoEntry) => {
                let key = Aes256Gcm::generate_key(OsRng);
                entry.set_password(&encode_hex(&key)).map_err(|_| CryptoError::Keychain)?;
                Ok(Self(key))
            }
            Err(_) => Err(CryptoError::Keychain),
        }
    }

    pub fn encrypt(&self, plaintext: &[u8]) -> Vec<u8> {
        let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
        let ciphertext = Aes256Gcm::new(&self.0)
            .encrypt(&nonce, plaintext)
            .expect("AES-GCM encryption does not fail for in-memory buffers");
        let mut out = Vec::with_capacity(MAGIC.len() + NONCE_LEN + ciphertext.len());
        out.extend_from_slice(MAGIC);
        out.extend_from_slice(&nonce);
        out.extend_from_slice(&ciphertext);
        out
    }

    pub fn decrypt(&self, data: &[u8]) -> Result<Vec<u8>, CryptoError> {
        if data.len() < MAGIC.len() + NONCE_LEN || &data[..MAGIC.len()] != MAGIC {
            return Err(CryptoError::Malformed);
        }
        let nonce = Nonce::from_slice(&data[MAGIC.len()..MAGIC.len() + NONCE_LEN]);
        Aes256Gcm::new(&self.0).decrypt(nonce, &data[MAGIC.len() + NONCE_LEN..]).map_err(|_| CryptoError::Authentication)
    }
}

fn encode_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn decode_hex(hex: &str) -> Option<Vec<u8>> {
    if hex.len() != 64 {
        return None;
    }
    (0..hex.len()).step_by(2).map(|i| u8::from_str_radix(&hex[i..i + 2], 16).ok()).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_and_uses_fresh_nonces() {
        let key = RecordingKey::for_tests(7);
        let a = key.encrypt(b"lecture audio");
        let b = key.encrypt(b"lecture audio");
        assert_ne!(a, b, "a new nonce per file");
        assert_eq!(key.decrypt(&a).unwrap(), b"lecture audio");
    }

    #[test]
    fn rejects_tampering_wrong_key_and_garbage() {
        let key = RecordingKey::for_tests(7);
        let mut sealed = key.encrypt(b"lecture audio");
        let last = sealed.len() - 1;
        sealed[last] ^= 1;
        assert_eq!(key.decrypt(&sealed), Err(CryptoError::Authentication));
        assert_eq!(RecordingKey::for_tests(8).decrypt(&key.encrypt(b"x")), Err(CryptoError::Authentication));
        assert_eq!(key.decrypt(b"nope"), Err(CryptoError::Malformed));
    }

    #[test]
    fn hex_round_trip() {
        let bytes = [0u8, 1, 254, 255].repeat(8);
        assert_eq!(decode_hex(&encode_hex(&bytes)).unwrap(), bytes);
        assert_eq!(decode_hex("zz"), None);
    }
}
