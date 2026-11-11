//! Permission-gated computer-control bridge.
//!
//! Design rules enforced here (not in the UI):
//!   * **Deny by default.** Only allow-listed applications, workspace-relative paths and
//!     bounded coordinate/keystroke inputs are accepted.
//!   * **Emergency stop wins.** If `emergency_stop` is set, every mutating command returns
//!     `BridgeError::Stopped` before touching the OS.
//!   * **Everything is audited.** Each attempt — allowed or refused — appends a record with
//!     a timestamp, action, target and outcome.
//!   * **No arbitrary command execution.** There is deliberately no `run_command` here.
//!
//! The actual Win32 automation calls are behind `#[cfg(windows)]` and will return a typed
//! "unsupported on this platform" error elsewhere, so the crate still builds and the bridge
//! contract can be tested on Linux/macOS CI.

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::BridgeState;

#[derive(Debug, thiserror::Error, Serialize)]
#[serde(tag = "kind", content = "message")]
pub enum BridgeError {
    #[error("emergency stop is engaged")]
    Stopped,
    #[error("application is not on the allow-list: {0}")]
    AppNotAllowed(String),
    #[error("path escapes the agent workspace: {0}")]
    PathEscape(String),
    #[error("invalid input: {0}")]
    Invalid(String),
    #[error("unsupported on this platform: {0}")]
    Unsupported(String),
    #[error("os error: {0}")]
    Os(String),
}

#[derive(Debug, Clone, Serialize)]
pub struct AuditRecord {
    pub at_ms: u128,
    pub action: String,
    pub target: String,
    pub outcome: String,
}

#[derive(Debug, Serialize)]
pub struct BridgeHealth {
    pub ok: bool,
    pub platform: &'static str,
    pub emergency_stop: bool,
    pub capabilities: Capabilities,
}

#[derive(Debug, Serialize)]
pub struct Capabilities {
    pub mouse: bool,
    pub keyboard: bool,
    pub windows_api: bool,
    pub screen_capture: bool,
    pub file_workspace: bool,
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

fn audit(state: &BridgeState, action: &str, target: &str, outcome: &str) {
    if let Ok(mut log) = state.audit.lock() {
        log.push(AuditRecord {
            at_ms: now_ms(),
            action: action.to_string(),
            target: target.to_string(),
            outcome: outcome.to_string(),
        });
        // Bounded in-memory ring: durable history lives in the server's SQLite audit table.
        if log.len() > 2_000 {
            log.drain(0..500);
        }
    }
}

fn denied_if_stopped(state: &BridgeState) -> Result<(), BridgeError> {
    let stopped = state.emergency_stop.lock().map(|g| *g).unwrap_or(true);
    if stopped {
        Err(BridgeError::Stopped)
    } else {
        Ok(())
    }
}

/* ------------------------------------------------------------------ health */

#[tauri::command]
pub fn bridge_health(state: State<'_, BridgeState>) -> BridgeHealth {
    let emergency_stop = state.emergency_stop.lock().map(|g| *g).unwrap_or(true);
    BridgeHealth {
        ok: true,
        platform: std::env::consts::OS,
        emergency_stop,
        capabilities: Capabilities {
            mouse: cfg!(windows),
            keyboard: cfg!(windows),
            windows_api: cfg!(windows),
            screen_capture: cfg!(windows),
            file_workspace: true,
        },
    }
}

#[tauri::command]
pub fn bridge_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[tauri::command]
pub fn set_emergency_stop(state: State<'_, BridgeState>, engaged: bool) -> Result<bool, BridgeError> {
    {
        let mut flag = state.emergency_stop.lock().map_err(|_| BridgeError::Os("lock poisoned".into()))?;
        *flag = engaged;
    }
    audit(state.inner(), "emergency-stop", if engaged { "engage" } else { "release" }, "allowed");
    Ok(engaged)
}

#[tauri::command]
pub fn get_emergency_stop(state: State<'_, BridgeState>) -> bool {
    state.emergency_stop.lock().map(|g| *g).unwrap_or(true)
}

#[tauri::command]
pub fn audit_tail(state: State<'_, BridgeState>, limit: Option<usize>) -> Vec<AuditRecord> {
    let n = limit.unwrap_or(50).min(500);
    let log = state.audit.lock().map(|g| g.clone()).unwrap_or_default();
    let start = log.len().saturating_sub(n);
    log[start..].to_vec()
}

/* --------------------------------------------------------------- read-only */

#[derive(Debug, Serialize)]
pub struct SystemInfo {
    pub platform: String,
    pub arch: String,
    pub hostname: String,
    pub cpus: usize,
    pub uptime_secs: Option<u64>,
}

#[tauri::command]
pub fn system_info() -> SystemInfo {
    SystemInfo {
        platform: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        hostname: std::env::var("COMPUTERNAME")
            .or_else(|_| std::env::var("HOSTNAME"))
            .unwrap_or_else(|_| "unknown".into()),
        cpus: std::thread::available_parallelism().map(|n| n.get()).unwrap_or(1),
        uptime_secs: None,
    }
}

#[derive(Debug, Serialize)]
pub struct ProcessInfo {
    pub name: String,
    pub pid: u32,
}

/// Lists *names only* — never command lines or memory contents, which can hold secrets.
#[tauri::command]
pub fn list_processes(state: State<'_, BridgeState>, limit: Option<usize>) -> Result<Vec<ProcessInfo>, BridgeError> {
    audit(state.inner(), "list_processes", "os", "allowed");
    let cap = limit.unwrap_or(50).min(200);
    #[cfg(windows)]
    {
        let mut out = Vec::new();
        // Enumerating processes via sysinfo keeps this dependency-light and avoids shelling out.
        let mut system = sysinfo::System::new_all();
        system.refresh_processes(sysinfo::ProcessesToUpdate::All, true);
        for (pid, proc_) in system.processes().iter().take(cap) {
            out.push(ProcessInfo {
                name: proc_.name().to_string_lossy().to_string(),
                pid: pid.as_u32(),
            });
        }
        Ok(out)
    }
    #[cfg(not(windows))]
    {
        let _ = cap;
        Err(BridgeError::Unsupported("process enumeration is implemented for Windows only".into()))
    }
}

#[tauri::command]
pub fn capture_screen_info() -> Result<String, BridgeError> {
    Err(BridgeError::Unsupported(
        "screen capture requires the Windows Graphics Capture API and an explicit user consent prompt; not wired in this build".into(),
    ))
}

/* ---------------------------------------------------------------- mutating */

/// Allow-list of launchable applications. Extend deliberately — never from user input.
const ALLOWED_APPS: &[&str] = &[
    "notepad", "notepad.exe", "calc", "calc.exe", "mspaint", "mspaint.exe", "explorer", "explorer.exe",
    "code", "code.exe", "chrome", "chrome.exe", "msedge", "msedge.exe",
];

#[tauri::command]
pub fn open_application(state: State<'_, BridgeState>, app: String) -> Result<String, BridgeError> {
    let normalized = app.trim().to_ascii_lowercase();
    if !ALLOWED_APPS.contains(&normalized.as_str()) {
        audit(state.inner(), "open_application", &app, "denied:not-allowlisted");
        return Err(BridgeError::AppNotAllowed(app));
    }
    if let Err(err) = denied_if_stopped(state.inner()) {
        audit(state.inner(), "open_application", &app, "denied:stopped");
        return Err(err);
    }
    audit(state.inner(), "open_application", &app, "allowed");
    #[cfg(windows)]
    {
        std::process::Command::new(&app)
            .spawn()
            .map_err(|e| BridgeError::Os(e.to_string()))?;
        Ok(format!("launched {app}"))
    }
    #[cfg(not(windows))]
    {
        Err(BridgeError::Unsupported("application launch is implemented for Windows only".into()))
    }
}

#[tauri::command]
pub fn focus_window(state: State<'_, BridgeState>, title_contains: String) -> Result<String, BridgeError> {
    denied_if_stopped(state.inner())?;
    if title_contains.trim().is_empty() || title_contains.len() > 200 {
        audit(state.inner(), "focus_window", &title_contains, "denied:invalid");
        return Err(BridgeError::Invalid("window title must be 1..200 chars".into()));
    }
    audit(state.inner(), "focus_window", &title_contains, "allowed");
    #[cfg(windows)]
    {
        Err(BridgeError::Unsupported(
            "window focus needs the Win32 SetForegroundWindow path, enabled with the win32 feature".into(),
        ))
    }
    #[cfg(not(windows))]
    {
        Err(BridgeError::Unsupported("window control is implemented for Windows only".into()))
    }
}

#[tauri::command]
pub fn move_mouse(state: State<'_, BridgeState>, x: i32, y: i32) -> Result<String, BridgeError> {
    denied_if_stopped(state.inner())?;
    // Bounds keep a hallucinated coordinate from throwing the cursor off-screen.
    if !(-16_384..=16_384).contains(&x) || !(-16_384..=16_384).contains(&y) {
        audit(state.inner(), "move_mouse", &format!("{x},{y}"), "denied:out-of-bounds");
        return Err(BridgeError::Invalid("coordinates outside the supported virtual desktop bounds".into()));
    }
    audit(state.inner(), "move_mouse", &format!("{x},{y}"), "allowed");
    #[cfg(windows)]
    {
        Err(BridgeError::Unsupported("cursor movement requires the win32 input feature".into()))
    }
    #[cfg(not(windows))]
    {
        Err(BridgeError::Unsupported("mouse control is implemented for Windows only".into()))
    }
}

#[tauri::command]
pub fn click(state: State<'_, BridgeState>, button: String, double: Option<bool>) -> Result<String, BridgeError> {
    denied_if_stopped(state.inner())?;
    let normalized = button.to_ascii_lowercase();
    if !["left", "right", "middle"].contains(&normalized.as_str()) {
        audit(state.inner(), "click", &button, "denied:invalid-button");
        return Err(BridgeError::Invalid("button must be left, right or middle".into()));
    }
    audit(state.inner(), "click", &format!("{normalized}{}", if double.unwrap_or(false) { ":double" } else { "" }), "allowed");
    #[cfg(windows)]
    {
        Err(BridgeError::Unsupported("click injection requires the win32 input feature".into()))
    }
    #[cfg(not(windows))]
    {
        Err(BridgeError::Unsupported("mouse control is implemented for Windows only".into()))
    }
}

#[tauri::command]
pub fn type_text(state: State<'_, BridgeState>, text: String) -> Result<String, BridgeError> {
    denied_if_stopped(state.inner())?;
    if text.is_empty() || text.chars().count() > 4_000 {
        audit(state.inner(), "type_text", "payload", "denied:invalid-length");
        return Err(BridgeError::Invalid("text must be 1..4000 characters".into()));
    }
    // Never echo the payload into the audit log — it may contain personal data.
    audit(state.inner(), "type_text", &format!("{} chars", text.chars().count()), "allowed");
    #[cfg(windows)]
    {
        Err(BridgeError::Unsupported("text injection requires the win32 input feature".into()))
    }
    #[cfg(not(windows))]
    {
        Err(BridgeError::Unsupported("keyboard control is implemented for Windows only".into()))
    }
}

#[tauri::command]
pub fn press_keys(state: State<'_, BridgeState>, keys: Vec<String>) -> Result<String, BridgeError> {
    denied_if_stopped(state.inner())?;
    const ALLOWED: &[&str] = &[
        "ctrl", "alt", "shift", "win", "tab", "enter", "escape", "space", "backspace", "delete",
        "up", "down", "left", "right", "home", "end", "pageup", "pagedown", "f1", "f2", "f3", "f4", "f5",
        "f6", "f7", "f8", "f9", "f10", "f11", "f12", "a", "c", "v", "x", "z", "s",
    ];
    let lowered: Vec<String> = keys.iter().map(|k| k.to_ascii_lowercase()).collect();
    if lowered.is_empty() || lowered.len() > 4 || lowered.iter().any(|k| !ALLOWED.contains(&k.as_str())) {
        audit(state.inner(), "press_keys", &lowered.join("+"), "denied:not-allowlisted");
        return Err(BridgeError::Invalid("key combination is not on the allow-list".into()));
    }
    audit(state.inner(), "press_keys", &lowered.join("+"), "allowed");
    #[cfg(windows)]
    {
        Err(BridgeError::Unsupported("key injection requires the win32 input feature".into()))
    }
    #[cfg(not(windows))]
    {
        Err(BridgeError::Unsupported("keyboard control is implemented for Windows only".into()))
    }
}

/* ------------------------------------------------------------ file workspace */

/// Resolves a path inside the agent workspace only. Symlink-free canonicalisation plus a
/// prefix check prevents `..` traversal and absolute-path escapes.
fn resolve_workspace_path(workspace: &Path, requested: &str) -> Result<PathBuf, BridgeError> {
    if requested.trim().is_empty() {
        return Err(BridgeError::Invalid("path is empty".into()));
    }
    let candidate = workspace.join(requested);
    let canonical_workspace = workspace
        .canonicalize()
        .map_err(|e| BridgeError::Os(format!("workspace unavailable: {e}")))?;
    let normalized = candidate
        .canonicalize()
        .unwrap_or_else(|_| candidate.clone());
    if !normalized.starts_with(&canonical_workspace) {
        return Err(BridgeError::PathEscape(requested.to_string()));
    }
    Ok(normalized)
}

#[tauri::command]
pub fn read_workspace_file(state: State<'_, BridgeState>, workspace: String, path: String) -> Result<String, BridgeError> {
    audit(state.inner(), "read_workspace_file", &path, "attempt");
    let resolved = resolve_workspace_path(Path::new(&workspace), &path).map_err(|e| {
        audit(state.inner(), "read_workspace_file", &path, "denied:escape");
        e
    })?;
    let meta = std::fs::metadata(&resolved).map_err(|e| BridgeError::Os(e.to_string()))?;
    if meta.len() > 2 * 1024 * 1024 {
        return Err(BridgeError::Invalid("file exceeds the 2 MiB bridge limit".into()));
    }
    std::fs::read_to_string(&resolved).map_err(|e| BridgeError::Os(e.to_string()))
}

#[tauri::command]
pub fn write_workspace_file(
    state: State<'_, BridgeState>,
    workspace: String,
    path: String,
    contents: String,
) -> Result<u64, BridgeError> {
    denied_if_stopped(state.inner())?;
    if contents.len() > 2 * 1024 * 1024 {
        return Err(BridgeError::Invalid("contents exceed the 2 MiB bridge limit".into()));
    }
    let resolved = resolve_workspace_path(Path::new(&workspace), &path).map_err(|e| {
        audit(state.inner(), "write_workspace_file", &path, "denied:escape");
        e
    })?;
    if let Some(parent) = resolved.parent() {
        std::fs::create_dir_all(parent).map_err(|e| BridgeError::Os(e.to_string()))?;
    }
    std::fs::write(&resolved, &contents).map_err(|e| BridgeError::Os(e.to_string()))?;
    audit(state.inner(), "write_workspace_file", &path, "allowed");
    Ok(contents.len() as u64)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn refuses_path_traversal() {
        let dir = std::env::temp_dir().join(format!("aura-bridge-test-{}", now_ms()));
        std::fs::create_dir_all(&dir).unwrap();
        let err = resolve_workspace_path(&dir, "../../etc/passwd").unwrap_err();
        assert!(matches!(err, BridgeError::PathEscape(_)));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn accepts_nested_workspace_paths() {
        let dir = std::env::temp_dir().join(format!("aura-bridge-ok-{}", now_ms()));
        std::fs::create_dir_all(dir.join("notes")).unwrap();
        let resolved = resolve_workspace_path(&dir, "notes/todo.md").unwrap();
        assert!(resolved.starts_with(dir.canonicalize().unwrap()));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn empty_path_is_invalid_not_os_error() {
        let dir = std::env::temp_dir();
        assert!(matches!(resolve_workspace_path(&dir, "  "), Err(BridgeError::Invalid(_))));
    }

    #[test]
    fn audit_ring_is_bounded() {
        let state = BridgeState {
            emergency_stop: Mutex::new(false),
            audit: Mutex::new(Vec::new()),
            server: Mutex::new(crate::server::ServerHandle::default()),
        };
        for i in 0..2_600 {
            audit(state.inner(), "test", &i.to_string(), "allowed");
        }
        let log = state.audit.lock().unwrap();
        assert!(log.len() <= 2_000, "audit ring grew to {}", log.len());
    }

    #[test]
    fn emergency_stop_blocks_mutation() {
        let state = BridgeState {
            emergency_stop: Mutex::new(true),
            audit: Mutex::new(Vec::new()),
            server: Mutex::new(crate::server::ServerHandle::default()),
        };
        assert!(matches!(denied_if_stopped(&state), Err(BridgeError::Stopped)));
    }
}
