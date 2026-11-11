import type { SqlDriver } from './types.js';
import { newId } from '../util/ids.js';
import { nowIso } from '../util/time.js';
import { safeParse, toJson } from '../util/json.js';

export type EntitlementRecord = {
  id: string;
  kind: 'account' | 'license' | 'subscription';
  status: 'active' | 'expired' | 'invalid' | 'unverified' | 'canceled' | 'grace';
  plan: string;
  subject: string | null;
  licenseKeyHint: string | null;
  deviceId: string | null;
  issuedAt: string;
  expiresAt: string | null;
  features: string[];
  signature: string | null;
  payload: Record<string, unknown>;
  source: 'dev' | 'remote' | 'offline';
  updatedAt: string;
};

type Row = {
  id: string;
  kind: string;
  status: string;
  plan: string;
  subject: string | null;
  license_key_hint: string | null;
  device_id: string | null;
  issued_at: string;
  expires_at: string | null;
  features_json: string;
  signature: string | null;
  payload_json: string;
  source: string;
  updated_at: string;
};

export class LicenseRepo {
  constructor(private readonly db: SqlDriver) {}

  private map(r: Row): EntitlementRecord {
    return {
      id: r.id,
      kind: r.kind as EntitlementRecord['kind'],
      status: r.status as EntitlementRecord['status'],
      plan: r.plan,
      subject: r.subject,
      licenseKeyHint: r.license_key_hint,
      deviceId: r.device_id,
      issuedAt: r.issued_at,
      expiresAt: r.expires_at,
      features: safeParse<string[]>(r.features_json, []),
      signature: r.signature,
      payload: safeParse<Record<string, unknown>>(r.payload_json, {}),
      source: r.source as EntitlementRecord['source'],
      updatedAt: r.updated_at,
    };
  }

  list(): EntitlementRecord[] {
    return this.db.all<Row>('SELECT * FROM entitlements ORDER BY updated_at DESC').map((r) => this.map(r));
  }

  get(kind: EntitlementRecord['kind']): EntitlementRecord | null {
    const row = this.db.get<Row>('SELECT * FROM entitlements WHERE kind = ? ORDER BY updated_at DESC LIMIT 1', [kind]);
    return row ? this.map(row) : null;
  }

  save(input: Omit<EntitlementRecord, 'id' | 'updatedAt'> & { id?: string }): EntitlementRecord {
    const id = input.id ?? newId('ent');
    const now = nowIso();
    this.db.run(
      `INSERT INTO entitlements (id, kind, status, plan, subject, license_key_hint, device_id, issued_at, expires_at, features_json, signature, payload_json, source, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET status=excluded.status, plan=excluded.plan, subject=excluded.subject, expires_at=excluded.expires_at,
         features_json=excluded.features_json, signature=excluded.signature, payload_json=excluded.payload_json, updated_at=excluded.updated_at`,
      [
        id,
        input.kind,
        input.status,
        input.plan,
        input.subject,
        input.licenseKeyHint,
        input.deviceId,
        input.issuedAt,
        input.expiresAt,
        toJson(input.features),
        input.signature,
        toJson(input.payload),
        input.source,
        now,
      ],
    );
    const row = this.db.get<Row>('SELECT * FROM entitlements WHERE id = ?', [id]);
    return this.map(row!);
  }

  remove(kind: EntitlementRecord['kind']): void {
    this.db.run('DELETE FROM entitlements WHERE kind = ?', [kind]);
  }

  account(): { id: string; provider: string; email: string; name: string | null; pictureUrl: string | null; lastLoginAt: string } | null {
    const row = this.db.get<{
      id: string;
      provider: string;
      email: string;
      name: string | null;
      picture_url: string | null;
      last_login_at: string;
    }>('SELECT * FROM accounts ORDER BY last_login_at DESC LIMIT 1');
    return row
      ? { id: row.id, provider: row.provider, email: row.email, name: row.name, pictureUrl: row.picture_url, lastLoginAt: row.last_login_at }
      : null;
  }

  saveAccount(input: { provider: string; email: string; name?: string | null; pictureUrl?: string | null }): void {
    const existing = this.db.get<{ id: string }>('SELECT id FROM accounts WHERE provider = ? AND email = ?', [input.provider, input.email]);
    const now = nowIso();
    if (existing) {
      this.db.run('UPDATE accounts SET name = ?, picture_url = ?, last_login_at = ? WHERE id = ?', [input.name ?? null, input.pictureUrl ?? null, now, existing.id]);
    } else {
      this.db.run('INSERT INTO accounts (id, provider, email, name, picture_url, created_at, last_login_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [
        newId('acc'),
        input.provider,
        input.email,
        input.name ?? null,
        input.pictureUrl ?? null,
        now,
        now,
      ]);
    }
  }

  signOut(): void {
    this.db.run('DELETE FROM accounts');
  }
}
