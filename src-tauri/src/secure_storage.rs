use keyring::Entry;
use serde::{Deserialize, Serialize};

const SERVICE_NAME: &str = "IntelliNoteSecureConfig";
const ACCOUNT_NAME: &str = "api_config";

#[derive(Debug, Serialize, Deserialize)]
pub struct SecureApiConfig {
    pub provider: String,
    pub api_key: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub base_url: Option<String>,
}

fn keyring_entry() -> Result<Entry, keyring::Error> {
    Entry::new(SERVICE_NAME, ACCOUNT_NAME)
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
