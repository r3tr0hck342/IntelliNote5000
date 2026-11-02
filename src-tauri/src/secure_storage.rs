use keyring::Entry;
use serde_json::Value;

const SERVICE_NAME: &str = "IntelliNoteSecureConfig";
const ACCOUNT_NAME: &str = "api_config";
const STT_ACCOUNT_NAME: &str = "stt_config";

// Configs are stored as the exact JSON the frontend sends. A typed struct here drifted from the
// TypeScript shape (it expected `api_key`, the app sends `apiKey`), which made every save fail.
fn save(account: &str, config: Value) -> Result<(), String> {
    if !config.is_object() {
        return Err("config must be a JSON object".into());
    }
    let entry = Entry::new(SERVICE_NAME, account).map_err(|e| e.to_string())?;
    entry.set_password(&config.to_string()).map_err(|e| e.to_string())
}

fn load(account: &str) -> Result<Option<Value>, String> {
    let entry = Entry::new(SERVICE_NAME, account).map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(raw) => serde_json::from_str(&raw).map(Some).map_err(|e| e.to_string()),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(err) => Err(err.to_string()),
    }
}

fn clear(account: &str) -> Result<(), String> {
    let entry = Entry::new(SERVICE_NAME, account).map_err(|e| e.to_string())?;
    match entry.delete_password() {
        Ok(_) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(err) => Err(err.to_string()),
    }
}

#[tauri::command]
pub fn secure_save_api_config(config: Value) -> Result<(), String> {
    save(ACCOUNT_NAME, config)
}

#[tauri::command]
pub fn secure_load_api_config() -> Result<Option<Value>, String> {
    load(ACCOUNT_NAME)
}

#[tauri::command]
pub fn secure_clear_api_config() -> Result<(), String> {
    clear(ACCOUNT_NAME)
}

#[tauri::command]
pub fn secure_save_stt_config(config: Value) -> Result<(), String> {
    save(STT_ACCOUNT_NAME, config)
}

#[tauri::command]
pub fn secure_load_stt_config() -> Result<Option<Value>, String> {
    load(STT_ACCOUNT_NAME)
}

#[tauri::command]
pub fn secure_clear_stt_config() -> Result<(), String> {
    clear(STT_ACCOUNT_NAME)
}
