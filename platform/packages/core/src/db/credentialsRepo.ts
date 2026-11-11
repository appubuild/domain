import type { SqlDriver } from './types.js';
import { nowIso } from '../util/time.js';

export type CredentialRecord = {
  provider: string;
  encryptedKey: string;
  keyHint: string;
  baseUrl: string | null;
  addedAt: string;
  lastVerifiedAt: string | null;
  lastStatus: string;
};

type Row = {
  provider: string;
  encrypted_key: string;
  key_hint: string;
  base_url: string | null;
  added_at: string;
  last_verified_at: string | null;
  last_status: string;
};

/**
 * Stores only ciphertext produced by the secret vault (AES-256-GCM with a key held in
 * the OS credential store, or a 0600 key file in dev mode). Plaintext keys never touch
 * the database, logs, or the frontend.
 */
export class CredentialsRepo {
  constructor(private readonly db: SqlDriver) {}

  private map(r: Row): CredentialRecord {
    return {
      provider: r.provider,
      encryptedKey: r.encrypted_key,
      keyHint: r.key_hint,
      baseUrl: r.base_url,
      addedAt: r.added_at,
      lastVerifiedAt: r.last_verified_at,
      lastStatus: r.last_status,
    };
  }

  get(provider: string): CredentialRecord | null {
    const row = this.db.get<Row>('SELECT * FROM provider_credentials WHERE provider = ?', [provider]);
    return row ? this.map(row) : null;
  }

  list(): CredentialRecord[] {
    return this.db.all<Row>('SELECT * FROM provider_credentials ORDER BY provider').map((r) => this.map(r));
  }

  save(input: { provider: string; encryptedKey: string; keyHint: string; baseUrl?: string | null }): CredentialRecord {
    this.db.run(
      `INSERT INTO provider_credentials (provider, encrypted_key, key_hint, base_url, added_at, last_verified_at, last_status)
       VALUES (?, ?, ?, ?, ?, NULL, 'unverified')
       ON CONFLICT(provider) DO UPDATE SET encrypted_key = excluded.encrypted_key, key_hint = excluded.key_hint,
         base_url = excluded.base_url, added_at = excluded.added_at, last_verified_at = NULL, last_status = 'unverified'`,
      [input.provider, input.encryptedKey, input.keyHint, input.baseUrl ?? null, nowIso()],
    );
    return this.get(input.provider)!;
  }

  markVerified(provider: string, status: 'valid' | 'invalid' | 'rate_limited' | 'network_error'): void {
    this.db.run('UPDATE provider_credentials SET last_verified_at = ?, last_status = ? WHERE provider = ?', [nowIso(), status, provider]);
  }

  remove(provider: string): void {
    this.db.run('DELETE FROM provider_credentials WHERE provider = ?', [provider]);
  }
}
