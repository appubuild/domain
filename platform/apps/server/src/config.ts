import { homedir, platform } from 'node:os';
import { join, resolve } from 'node:path';
import { mkdirSync, existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

export type ServerConfig = {
  port: number;
  host: string;
  dataDir: string;
  dbPath: string;
  workspaceRoot: string;
  keyPath: string;
  devMode: boolean;
  capabilityMode: 'server' | 'desktop';
};

/**
 * Resolves the application data directory using the platform convention
 * (Windows: %APPDATA%/AURA, macOS: ~/Library/Application Support/AURA, Linux: XDG).
 */
export function defaultDataDir(): string {
  if (process.env.AURA_DATA_DIR) return resolve(process.env.AURA_DATA_DIR);
  const p = platform();
  if (p === 'win32') return join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'AURA');
  if (p === 'darwin') return join(homedir(), 'Library', 'Application Support', 'AURA');
  return join(process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share'), 'aura');
}

export function loadConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  const dataDir = overrides.dataDir ?? defaultDataDir();
  mkdirSync(dataDir, { recursive: true });
  const devMode = overrides.devMode ?? (process.env.AURA_DEV_LICENSE === '1' || process.env.NODE_ENV !== 'production');
  const workspaceRoot = overrides.workspaceRoot ?? resolve(process.env.AURA_WORKSPACE ?? join(dataDir, 'workspace'));
  mkdirSync(workspaceRoot, { recursive: true });
  return {
    port: Number(process.env.PORT ?? overrides.port ?? 8787),
    host: process.env.HOST ?? overrides.host ?? '0.0.0.0',
    dataDir,
    dbPath: overrides.dbPath ?? join(dataDir, 'aura.sqlite'),
    workspaceRoot,
    keyPath: join(dataDir, 'vault.key'),
    devMode,
    // The Tauri shell exports AURA_DESKTOP=1 before spawning us. Capabilities are derived
    // from that flag and the bridge URL only — never assumed.
    capabilityMode:
      (process.env.AURA_CAPABILITY_MODE as 'server' | 'desktop' | undefined) ??
      (process.env.AURA_DESKTOP === '1' ? 'desktop' : 'server'),
  };
}

/** Loads or creates the 32-byte vault key with owner-only permissions. */
export function loadOrCreateVaultKey(keyPath: string): Uint8Array {
  if (existsSync(keyPath)) {
    const buf = readFileSync(keyPath);
    if (buf.length !== 32) throw new Error(`Vault key at ${keyPath} is corrupt (expected 32 bytes)`);
    return new Uint8Array(buf);
  }
  const key = randomBytes(32);
  writeFileSync(keyPath, key, { mode: 0o600 });
  try {
    chmodSync(keyPath, 0o600);
  } catch {
    /* Windows ACLs: best-effort; DATA dir is per-user */
  }
  return new Uint8Array(key);
}

export function getDeviceId(dataDir: string): string {
  const file = join(dataDir, 'device.id');
  if (existsSync(file)) return readFileSync(file, 'utf8').trim();
  const id = `dev_${randomBytes(12).toString('hex')}`;
  writeFileSync(file, id, { mode: 0o600 });
  return id;
}
