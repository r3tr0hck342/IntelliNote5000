use keyring::Entry;
use serde::{Deserialize, Serialize};

const SERVICE_NAME: &str = "IntelliNoteSecureConfig";
const ACCOUNT_NAME: &str = "api_config";
const STT_ACCOUNT_NAME: &str = "stt_config";

#[derive(Debug, Serialize, Deserialize)]
pub struct SecureApiConfig {
    pub provider: String,
    pub api_key: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub base_url: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SecureSttConfig {
    pub provider: String,
    pub api_key: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub language: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
}

fn keyring_entry() -> Result<Entry, keyring::Error> {
    Entry::new(SERVICE_NAME, ACCOUNT_NAME)
}

fn stt_keyring_entry() -> Result<Entry, keyring::Error> {
    Entry::new(SERVICE_NAME, STT_ACCOUNT_NAME)
}

#[tauri::command]
pub fn secure_save_api_config(config: SecureApiConfig) -> Result<(), String> {
    let entry = keyring_entry().map_err(|e| e.to_string())?;
    let serialized = serde_json::to_string(&config).map_err(|e| e.to_string())?;
    entry
        .set_password(&serialized)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn secure_load_api_config() -> Result<Option<SecureApiConfig>, String> {
    let entry = keyring_entry().map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(raw) => {
            let parsed: SecureApiConfig =
                serde_json::from_str(&raw).map_err(|e| e.to_string())?;
            Ok(Some(parsed))
        }
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(err) => Err(err.to_string()),
    }
}

#[tauri::command]
pub fn secure_clear_api_config() -> Result<(), String> {
    let entry = keyring_entry().map_err(|e| e.to_string())?;
    match entry.delete_password() {
        Ok(_) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(err) => Err(err.to_string()),
    }
}

#[tauri::command]
pub fn secure_save_stt_config(config: SecureSttConfig) -> Result<(), String> {
    let entry = stt_keyring_entry().map_err(|e| e.to_string())?;
    let serialized = serde_json::to_string(&config).map_err(|e| e.to_string())?;
    entry
        .set_password(&serialized)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn secure_load_stt_config() -> Result<Option<SecureSttConfig>, String> {
    let entry = stt_keyring_entry().map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(raw) => {
            let parsed: SecureSttConfig =
                serde_json::from_str(&raw).map_err(|e| e.to_string())?;
            Ok(Some(parsed))
        }
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(err) => Err(err.to_string()),
    }
}

#[tauri::command]
pub fn secure_clear_stt_config() -> Result<(), String> {
    let entry = stt_keyring_entry().map_err(|e| e.to_string())?;
    match entry.delete_password() {
        Ok(_) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(err) => Err(err.to_string()),
    }
}
