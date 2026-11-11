//! Supervises the local agent server.
//!
//! The desktop app does not embed Node. It starts the compiled server
//! (`apps/server/dist/main.js`) as a child process, proxies nothing, and reports the real
//! process status to the UI. If Node is missing or the server exits, `server_status`
//! reports the failure verbatim so the window can show a recovery panel instead of a
//! blank screen.

use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Mutex;

use serde::Serialize;
use tokio::process::{Child, Command};

#[derive(Debug, Default)]
pub struct ServerHandle {
    child: Option<Child>,
    /// Populated after an attempted start; `None` means "never started".
    last_error: Option<String>,
    started_at_ms: Option<u128>,
}

impl ServerHandle {
    pub fn is_running(&mut self) -> bool {
        // `try_wait` reaps exited children, so a crashed server is not reported as alive.
        match self.child.as_mut() {
            Some(child) => match child.try_wait() {
                Ok(Some(status)) => {
                    self.last_error = Some(format!("agent server exited with {status}"));
                    self.child = None;
                    false
                }
                Ok(None) => true,
                Err(err) => {
                    self.last_error = Some(err.to_string());
                    false
                }
            },
            None => false,
        }
    }

    pub fn shutdown(&mut self) {
        if let Some(child) = self.child.as_mut() {
            // Graceful SIGTERM/kill; the server closes SQLite cleanly on its own handler.
            let _ = child.start_kill();
        }
        self.child = None;
    }
}

#[derive(Debug, Serialize)]
pub struct ServerStatus {
    pub running: bool,
    pub port: u16,
    pub url: String,
    pub error: Option<String>,
    pub started_at_ms: Option<u128>,
}

fn server_entry() -> Option<PathBuf> {
    // Packaged builds place the server next to the executable under `resources/server`.
    // Development builds fall back to the monorepo path.
    let candidates = [
        std::env::current_exe().ok().and_then(|p| p.parent().map(|d| d.join("resources/server/main.js"))),
        std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|d| d.join("server/main.js"))),
        Some(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../server/dist/main.js")),
    ];
    candidates
        .into_iter()
        .flatten()
        .find(|p| p.exists())
}

/// Starts the server if a Node runtime and a built server entry are present.
pub async fn autostart(app: &tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<crate::BridgeState>();
    let entry = server_entry().ok_or_else(|| {
        "agent server bundle not found — run `npm run build` in platform/apps/server".to_string()
    })?;
    let port = std::env::var("AURA_PORT").unwrap_or_else(|_| "8787".into());

    let child = Command::new("node")
        .arg(&entry)
        .env("AURA_PORT", &port)
        .env("AURA_DESKTOP", "1")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("could not launch node: {e}. Install Node.js 22+ and relaunch AURA."))?;

    let mut guard = state.server.lock().map_err(|_| "server state lock poisoned".to_string())?;
    guard.child = Some(child);
    guard.started_at_ms = Some(
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0),
    );
    guard.last_error = None;
    Ok(())
}

fn status_for(state: &crate::BridgeState) -> ServerStatus {
    let mut guard = match state.server.lock() {
        Ok(g) => g,
        Err(_) => {
            return ServerStatus {
                running: false,
                port: 8787,
                url: "http://127.0.0.1:8787".into(),
                error: Some("server state lock poisoned".into()),
                started_at_ms: None,
            }
        }
    };
    let running = guard.is_running();
    let port: u16 = std::env::var("AURA_PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(8787);
    ServerStatus {
        running,
        port,
        url: format!("http://127.0.0.1:{port}"),
        error: guard.last_error.clone(),
        started_at_ms: guard.started_at_ms,
    }
}

#[tauri::command]
pub fn server_status(state: tauri::State<'_, crate::BridgeState>) -> ServerStatus {
    status_for(&state)
}

#[tauri::command]
pub async fn start_server(app: tauri::AppHandle) -> Result<ServerStatus, String> {
    {
        let state = app.state::<crate::BridgeState>();
        let mut guard = state.server.lock().map_err(|_| "server state lock poisoned".to_string())?;
        if guard.is_running() {
            return Ok(status_for(&state));
        }
    }
    autostart(&app).await?;
    let state = app.state::<crate::BridgeState>();
    Ok(status_for(&state))
}

#[tauri::command]
pub fn stop_server(state: tauri::State<'_, crate::BridgeState>) -> ServerStatus {
    if let Ok(mut guard) = state.server.lock() {
        guard.shutdown();
    }
    status_for(&state)
}
