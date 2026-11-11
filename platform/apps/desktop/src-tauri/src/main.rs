//! AURA desktop shell.
//!
//! Responsibilities of this process (and nothing more):
//!   1. Supervise the local agent server (`node apps/server/dist/main.js`) as a child process.
//!   2. Expose a *permission-gated, audit-logged* computer-control bridge over Tauri IPC.
//!   3. Own OS-level concerns: single-instance, tray, deep links, secure storage path.
//!
//! The webview never receives raw shell, raw filesystem or raw OS automation access. Every
//! privileged action goes through a command in `bridge.rs`, which checks an allow-list,
//! validates the input, and appends an audit record before doing anything.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod bridge;
mod server;

use std::sync::Mutex;

use tauri::Manager;

/// Runtime state shared by bridge commands.
pub struct BridgeState {
    /// Set when the user hits the emergency stop. No automation command runs while true.
    pub emergency_stop: Mutex<bool>,
    /// Monotonic sequence for the on-disk audit trail written by the bridge.
    pub audit: Mutex<Vec<bridge::AuditRecord>>,
    /// Handle to the supervised agent server so the UI can report its real status.
    pub server: Mutex<server::ServerHandle>,
}

fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "aura_desktop_lib=info,warn".into()),
        )
        .with_target(false)
        .init();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .manage(BridgeState {
            emergency_stop: Mutex::new(false),
            audit: Mutex::new(Vec::new()),
            server: Mutex::new(server::ServerHandle::default()),
        })
        .invoke_handler(tauri::generate_handler![
            bridge::bridge_health,
            bridge::bridge_version,
            bridge::set_emergency_stop,
            bridge::get_emergency_stop,
            bridge::audit_tail,
            bridge::system_info,
            bridge::list_processes,
            bridge::focus_window,
            bridge::open_application,
            bridge::move_mouse,
            bridge::click,
            bridge::type_text,
            bridge::press_keys,
            bridge::capture_screen_info,
            bridge::read_workspace_file,
            bridge::write_workspace_file,
            server::server_status,
            server::start_server,
            server::stop_server,
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            // Start the agent server in the background; failures are surfaced through
            // `server_status`, never swallowed into a fake "ready" state.
            tauri::async_runtime::spawn(async move {
                if let Err(err) = server::autostart(&handle).await {
                    tracing::error!("agent server failed to start: {err}");
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                // Releasing the child process prevents orphaned servers holding the DB lock.
                if let Some(state) = window.try_state::<BridgeState>() {
                    if let Ok(mut handle) = state.server.lock() {
                        handle.shutdown();
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("fatal: the Tauri runtime could not start");
}
