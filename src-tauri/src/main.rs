#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod secure_storage;

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            secure_storage::secure_save_api_config,
            secure_storage::secure_load_api_config,
            secure_storage::secure_clear_api_config,
            secure_storage::secure_save_stt_config,
            secure_storage::secure_load_stt_config,
            secure_storage::secure_clear_stt_config
        ])
        .run(tauri::generate_context!())
        .expect("error while running IntelliNote desktop application");
}
