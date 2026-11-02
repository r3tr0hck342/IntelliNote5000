#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod secure_storage;

use tauri::webview::{PermissionKind, PermissionResponse};

fn main() {
    // WebKitGTK's DMA-BUF renderer crashes on Wayland with NVIDIA GPUs ("Error 71 (Protocol error)").
    // Set before any threads start; an explicit user value still wins.
    #[cfg(target_os = "linux")]
    if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        // Recording is the core feature. Without this the webview's default applies, which
        // denies microphone access on Linux. macOS still shows its system prompt.
        .on_permission_request(|_, kind| match kind {
            PermissionKind::Microphone => PermissionResponse::Allow,
            _ => PermissionResponse::Default,
        })
        .setup(|app| {
            #[cfg(target_os = "linux")]
            enable_linux_media_stream(app)?;
            #[cfg(not(target_os = "linux"))]
            let _ = app;
            Ok(())
        })
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

// WebKitGTK ships with getUserMedia disabled; neither wry nor Tauri turns it on.
#[cfg(target_os = "linux")]
fn enable_linux_media_stream(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    use tauri::Manager;
    use webkit2gtk::{SettingsExt, WebViewExt};

    let window = app
        .get_webview_window("main")
        .ok_or("main window not found")?;
    window.with_webview(|webview| {
        if let Some(settings) = WebViewExt::settings(&webview.inner()) {
            settings.set_enable_media_stream(true);
        }
    })?;
    Ok(())
}
