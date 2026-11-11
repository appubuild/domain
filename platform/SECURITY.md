# AURA — Security

This document states what AURA protects, how, and — just as importantly — what it does **not**
protect against. A security claim you cannot verify is worse than no claim.

---

## 1. Threat model

### In scope

| Threat | Mitigation |
| --- | --- |
| API keys leaking to the browser, logs or source | Keys are encrypted at rest; the browser receives only a masked hint (`sk-…4f2a`); responses are redacted before logging |
| Another local user reading your database | Vault key is written `0600` in the per-user data directory; only ciphertext is stored in SQLite |
| A malicious skill manifest trying to gain powers | Manifests *declare* permissions; the registry and orchestrator *enforce* them. Imported skills start disabled, and shell permission is always refused |
| Prompt injection from web pages / documents / MCP output | External content is labelled as untrusted data in the prompt and scanned; tool output is never treated as instructions |
| Agent doing something destructive unsupervised | Permission engine (`allow` / `ask` / `deny` per permission), risk tagging per step, confirmation gate, emergency stop, audit log |
| Path traversal in file tools | All paths resolve inside the workspace; canonicalised + prefix-checked in both Node and Rust (`bridge.rs` tests cover `../../etc/passwd`) |
| Symlink escape from the workspace | Containment is checked against the **resolved real path** (`fs.realpath`), not just the lexical path — a symlink planted inside `workspace/` pointing at `~/.ssh` is refused. Covered by `filesystem.test.ts` |
| Arbitrary command execution | No generic shell command exists in the server or the desktop bridge. The bridge exposes a fixed allow-list of applications and key chords |
| Fake licensing / forged subscription | Ed25519 signature verification, device binding, no "activate anyway" path, no simulated payments |

### Explicitly out of scope (and said plainly)

- **A compromised OS account.** Malware running as you can read process memory and the vault key.
- **Provider-side behaviour.** What OpenAI/Anthropic/Google do with your prompts is governed by them.
- **A user who grants `allow` to `computer` and then runs an untrusted task.** The permission
  model is a guardrail, not a sandbox against deliberate misuse.
- **Web content that you paste into a chat.** It is treated as data, but social engineering of
  the human operator is not solvable by prompt engineering.

---

## 2. Secrets

### Storage

```
provider API key ──▶ validate shape ──▶ AES-256-GCM encrypt (vault key) ──▶ SQLite (ciphertext)
                                                  │
                                     vault.key (32 bytes, 0600, data dir)
```

- The vault key is generated once per installation and never leaves the machine.
- Ciphertext is prefixed (`v1.`) so the format can evolve; the key hint is stored separately
  for display only.
- Tests assert the stored value starts with `v1.`, that the plaintext key does **not** appear
  in the database row or in any API response, and that only the hint is returned.

### In transit

- Provider calls go directly from your machine to the provider over TLS. There is no AURA
  relay.
- The **Gemini Live key is used only inside the server process**; the browser's WebSocket
  carries audio and events, never the key. The WS endpoint refuses to start a session without
  a server-side key and returns a typed `not_configured` error instead.
- All responses pass through `redactSecrets()` before they can reach a log or an error body.

### Not done, on purpose

- No key is ever written to `localStorage`, `sessionStorage`, a cookie, a URL, or a build artifact.
- No key is embedded in the client bundle. There is no "demo key" in this repository.

---

## 3. Permission model

Permissions are global (`permissions` table) and per-character
(`character.config.permissions`). Both must allow an action.

| Permission | Typical risk | Notes |
| --- | --- | --- |
| `filesystem` | medium | Sandboxed to the workspace directory |
| `network` | low | Outbound research tools |
| `browser` | medium | Requires desktop runtime |
| `computer` | **high** | Mouse/keyboard/window control, desktop only |
| `shell` | **critical** | Refused for untrusted skills; no general shell tool exists |
| `screen` | high | Capture requires explicit consent |
| `clipboard` | medium | Read/write |
| `notifications` | low | System notifications |

Rules enforced server-side (see `core/src/agent/permissions.ts` and the orchestrator):

1. Emergency stop short-circuits **every** tool call.
2. `deny` wins over any character-level `allow`.
3. A step tagged `high` risk, or a permission set to `ask`, pauses the task in
   `awaiting_confirmation`; the user must explicitly grant it, which is audit-logged.
4. Skill-declared permissions are a *request*, checked against the two sources above.

---

## 4. Desktop bridge hardening

`apps/desktop/src-tauri/src/bridge.rs` is deliberately small and boring:

- **No `run_command`.** Applications come from a hard-coded allow-list.
- Key chords are allow-listed (`ctrl`, `alt`, `shift`, arrows, F-keys, a/c/v/x/z/s…).
- Coordinates are bounded; text length is bounded; payloads are never echoed into the audit log.
- File access canonicalises the requested path and rejects anything outside the workspace root.
  Where the host supports it, the canonical form is the symlink-resolved real path, so links
  cannot be used to step outside the sandbox.
- Every attempt — permitted or refused — is appended to an in-memory ring *and* the server's
  durable audit table.
- The webview capability file grants `core:default` + dialogs only. It cannot read arbitrary
  files or spawn processes through Tauri itself.

---

## 5. Prompt-injection posture

- Fetched pages, document chunks and tool results are inserted inside an explicit
  *untrusted data* envelope with instructions that content is data, not commands.
- `scanForInjection()` flags common override patterns and the orchestrator refuses steps whose
  arguments would have been rewritten by page content.
- Tool results are summarised before re-entering the model context; raw HTML is stripped.
- There is no auto-execution path from a document to a tool call: any tool use still passes
  the permission gate.

---

## 6. Data lifecycle

| Action | Effect |
| --- | --- |
| Delete a conversation | Messages removed; extracted memories remain until removed in Memory Center |
| Delete a character | Cascade: conversations, messages, memories, documents, chunks, tasks |
| Clear a memory layer | Per-character, per-layer, permanent |
| Delete all local data | Requires typing `DELETE`; provider keys are preserved by design |
| Backup export | Settings, characters, conversations, memories — **no keys, no license signature** |

---

## 7. Assets and licensing

- All character geometry is **generated procedurally** from numeric specs at runtime. No
  third-party model, texture or artwork is bundled.
- The UI font stack resolves to system fonts (Inter/Segoe UI fallbacks); no web font is
  downloaded.
- VRM import, when a user supplies a model, is the user's licensing responsibility. The app
  does not ship, fetch or embed VRM assets, and the UI states this where the import path is
  mentioned.
- The reference to Stonic AI is inspiration only; no branding, copy, assets or code from that
  product is used.

---

## 8. Reporting

For a local-first application the fastest path is a private issue describing the impact and a
reproduction. Please do not include real API keys in a report; a truncated hint is enough.
