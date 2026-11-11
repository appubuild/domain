import type { LicenseRepo } from '../db/licenseRepo.js';
import { DEV_FEATURES, type Entitlements, type Feature, type LicensePayload, type LicenseState, type SubscriptionState } from './types.js';
import { licensePayloadSchema } from './types.js';
import { daysFromNow, isExpired, nowIso } from '../util/time.js';

export const DEV_MODE_REASON =
  'Local development mode is active (AURA_DEV_LICENSE=1). All features are unlocked for this build; no commercial license server is connected.';

/** Ed25519 signature verification with the public key pinned by the build. */
export class LicenseVerifier {
  constructor(private readonly publicKeyJwk: JsonWebKey | null) {}

  get configured(): boolean {
    return this.publicKeyJwk !== null;
  }

  async verify(payloadB64: string, signatureB64: string): Promise<{ ok: true; payload: LicensePayload } | { ok: false; error: string }> {
    if (!this.publicKeyJwk) {
      return { ok: false, error: 'No license public key is pinned in this build. Production license validation is not provisioned yet.' };
    }
    try {
      const key = await crypto.subtle.importKey('jwk', this.publicKeyJwk, { name: 'Ed25519' }, false, ['verify']);
      const enc = new TextEncoder();
      const valid = await crypto.subtle.verify('Ed25519', key, buf(fromB64Url(signatureB64)), enc.encode(payloadB64));
      if (!valid) return { ok: false, error: 'License signature is invalid.' };
      const json = JSON.parse(new TextDecoder().decode(fromB64Url(payloadB64))) as unknown;
      const parsed = licensePayloadSchema.safeParse(json);
      if (!parsed.success) return { ok: false, error: `License payload malformed: ${parsed.error.issues[0]?.message ?? ''}` };
      return { ok: true, payload: parsed.data };
    } catch (err) {
      return { ok: false, error: `License verification failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  }
}

export function decodeLicenseKey(key: string): { payloadB64: string; signatureB64: string } | null {
  // License key format: AURA1.<base64url payload>.<base64url signature>
  const m = key.trim().match(/^AURA1\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/);
  return m?.[1] && m[2] ? { payloadB64: m[1], signatureB64: m[2] } : null;
}

function buf(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function fromB64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '==='.slice((b64.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export class LicensingEngine {
  constructor(
    private readonly repo: LicenseRepo,
    private readonly opts: {
      devMode: boolean;
      deviceId: string;
      verifier: LicenseVerifier;
      /** Grace period after last successful online validation. */
      offlineGraceDays?: number;
      subscriptionEndpoints?: { statusUrl: string; bearerToken: string | null; fetchImpl?: typeof fetch };
    },
  ) {}

  entitlements(): Entitlements {
    return { license: this.licenseState(), subscription: this.subscriptionState() };
  }

  hasFeature(entitlements: Entitlements, feature: Feature): boolean {
    if (entitlements.license.mode === 'development') return true;
    if (entitlements.license.mode === 'licensed' || entitlements.license.mode === 'grace') {
      return entitlements.license.features.includes(feature);
    }
    return false;
  }

  licenseState(): LicenseState {
    if (this.opts.devMode) {
      return {
        mode: 'development',
        plan: 'lifetime',
        features: DEV_FEATURES,
        reason: DEV_MODE_REASON,
        subject: 'local-development',
        expiresAt: null,
        lastValidatedAt: nowIso(),
        offlineGraceUntil: null,
        deviceId: this.opts.deviceId,
      };
    }
    const record = this.repo.get('license');
    if (!record) {
      return {
        mode: 'unlicensed',
        plan: 'none',
        features: [],
        reason: 'No lifetime license has been activated on this device.',
        subject: null,
        expiresAt: null,
        lastValidatedAt: null,
        offlineGraceUntil: null,
        deviceId: this.opts.deviceId,
      };
    }
    const features = record.features.filter((f): f is Feature => (DEV_FEATURES as string[]).includes(f));
    if (record.status === 'invalid') {
      return { mode: 'unlicensed', plan: 'none', features: [], reason: record.payload.reason as string ?? 'License validation failed.', subject: record.subject, expiresAt: record.expiresAt, lastValidatedAt: null, offlineGraceUntil: null, deviceId: this.opts.deviceId };
    }
    if (record.expiresAt && isExpired(record.expiresAt)) {
      return { mode: 'expired', plan: 'trial', features: [], reason: `License expired on ${record.expiresAt.slice(0, 10)}.`, subject: record.subject, expiresAt: record.expiresAt, lastValidatedAt: record.issuedAt, offlineGraceUntil: null, deviceId: this.opts.deviceId };
    }
    const graceUntil = daysFromNow(this.opts.offlineGraceDays ?? 14);
    const lastValid = record.issuedAt;
    const inGrace = Date.now() - new Date(lastValid).getTime() > 7 * 86_400_000;
    return {
      mode: inGrace ? 'grace' : 'licensed',
      plan: record.plan === 'trial' ? 'trial' : 'lifetime',
      features,
      reason: inGrace
        ? `Offline grace period: last validated ${lastValid.slice(0, 10)}. Reconnect within ${Math.ceil((new Date(graceUntil).getTime() - Date.now()) / 86_400_000)} days.`
        : `Lifetime license active for device ${this.opts.deviceId.slice(0, 12)}…`,
      subject: record.subject,
      expiresAt: record.expiresAt,
      lastValidatedAt: lastValid,
      offlineGraceUntil: inGrace ? graceUntil : null,
      deviceId: this.opts.deviceId,
    };
  }

  /** Activates a license key. Never fabricates success when verification cannot run. */
  async activate(key: string, accountEmail?: string): Promise<{ ok: boolean; message: string; state: LicenseState }> {
    if (this.opts.devMode) {
      return { ok: true, message: 'Development mode: license activation is not required.', state: this.licenseState() };
    }
    const decoded = decodeLicenseKey(key);
    if (!decoded) {
      return { ok: false, message: 'That does not look like an AURA license key (expected AURA1.<payload>.<signature>).', state: this.licenseState() };
    }
    const verified = await this.opts.verifier.verify(decoded.payloadB64, decoded.signatureB64);
    if (!verified.ok) {
      this.repo.save({
        kind: 'license',
        status: 'invalid',
        plan: 'lifetime',
        subject: null,
        licenseKeyHint: key.slice(0, 10),
        deviceId: this.opts.deviceId,
        issuedAt: nowIso(),
        expiresAt: null,
        features: [],
        signature: null,
        payload: { reason: verified.error },
        source: 'offline',
      });
      return { ok: false, message: verified.error, state: this.licenseState() };
    }
    const payload = verified.payload;
    if (payload.deviceId !== this.opts.deviceId && payload.plan === 'lifetime') {
      const msg = `This license is bound to a different device (${payload.deviceId.slice(0, 12)}…). Deactivate the other device first.`;
      return { ok: false, message: msg, state: this.licenseState() };
    }
    this.repo.remove('license');
    this.repo.save({
      kind: 'license',
      status: 'active',
      plan: payload.plan,
      subject: accountEmail ?? payload.email ?? payload.subject,
      licenseKeyHint: payload.licenseKeyHint,
      deviceId: payload.deviceId,
      issuedAt: nowIso(),
      expiresAt: payload.expiresAt,
      features: payload.features,
      signature: decoded.signatureB64,
      payload: payload as unknown as Record<string, unknown>,
      source: 'offline',
    });
    return { ok: true, message: 'Lifetime license verified and activated on this device.', state: this.licenseState() };
  }

  deactivate(): void {
    this.repo.remove('license');
  }

  subscriptionState(): SubscriptionState {
    const record = this.repo.get('subscription');
    if (!record) {
      return {
        status: 'none',
        plan: null,
        features: [],
        quotaTokensPerMonth: 0,
        periodEnd: null,
        reason: 'No cloud AI subscription. Chat and voice use your own provider API keys.',
        lastValidatedAt: null,
      };
    }
    const active = record.status === 'active' || record.status === 'grace';
    return {
      status: active ? 'active' : (record.status as SubscriptionState['status']),
      plan: record.plan,
      features: record.features,
      quotaTokensPerMonth: Number(record.payload.quotaTokensPerMonth ?? 0),
      periodEnd: record.expiresAt,
      reason: active ? `Cloud AI subscription (${record.plan}) active.` : `Subscription ${record.status}.`,
      lastValidatedAt: record.issuedAt,
    };
  }

  /** Server-side validation hook for cloud subscription tokens (prepared, not simulated). */
  async refreshSubscription(): Promise<SubscriptionState> {
    const ep = this.opts.subscriptionEndpoints;
    if (!ep?.bearerToken) return this.subscriptionState();
    try {
      const res = await (ep.fetchImpl ?? fetch)(ep.statusUrl, { headers: { Authorization: `Bearer ${ep.bearerToken}` } });
      if (!res.ok) return this.subscriptionState();
      const body = (await res.json()) as Record<string, unknown>;
      this.repo.remove('subscription');
      this.repo.save({
        kind: 'subscription',
        status: body.status === 'active' ? 'active' : 'unverified',
        plan: String(body.plan ?? 'unknown'),
        subject: null,
        licenseKeyHint: null,
        deviceId: this.opts.deviceId,
        issuedAt: nowIso(),
        expiresAt: typeof body.periodEnd === 'string' ? body.periodEnd : null,
        features: Array.isArray(body.features) ? (body.features as string[]) : [],
        signature: null,
        payload: body,
        source: 'remote',
      });
    } catch {
      /* network failure keeps previous state; never fabricate a subscription */
    }
    return this.subscriptionState();
  }
}
