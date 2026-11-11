import { describe, expect, it } from 'vitest';
import { LicensingEngine, LicenseVerifier, decodeLicenseKey } from '../src/licensing/engine.js';
import { LicenseRepo } from '../src/db/licenseRepo.js';
import { freshDb } from './helpers.js';

function engine(opts: { devMode?: boolean; verifier?: LicenseVerifier } = {}) {
  const db = freshDb();
  const e = new LicensingEngine(db.license, {
    devMode: opts.devMode ?? false,
    deviceId: 'dev_test_device',
    verifier: opts.verifier ?? new LicenseVerifier(null),
  });
  return { db, e };
}

describe('licensing (no fake success)', () => {
  it('dev mode unlocks features but is clearly labelled as development', () => {
    const { db, e } = engine({ devMode: true });
    const state = e.licenseState();
    expect(state.mode).toBe('development');
    expect(state.reason).toMatch(/Local development mode/);
    expect(e.hasFeature(e.entitlements(), 'agent.computer_control')).toBe(true);
    db.close();
  });

  it('without a license, features are locked and activation refuses unsigned keys', async () => {
    const { db, e } = engine();
    expect(e.licenseState().mode).toBe('unlicensed');
    expect(e.hasFeature(e.entitlements(), 'agent.tasks')).toBe(false);
    const res = await e.activate('AURA1.abc.def');
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/No license public key/);
    const bad = await e.activate('garbage-key');
    expect(bad.ok).toBe(false);
    expect(bad.message).toMatch(/does not look like/);
    db.close();
  });

  it('verifies a signed license with the pinned Ed25519 public key', async () => {
    // Generate a test keypair and sign a payload exactly like the future license server.
    const kp = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
    const pubJwk = await crypto.subtle.exportKey('jwk', kp.publicKey);
    const payload = {
      v: 1,
      kind: 'license',
      plan: 'lifetime',
      subject: 'buyer@example.com',
      email: 'buyer@example.com',
      features: ['characters.unlimited', 'avatar.procedural', 'agent.tasks'],
      deviceId: 'dev_test_device',
      issuedAt: new Date().toISOString(),
      expiresAt: null,
      licenseKeyHint: 'AURA1…abcd',
    };
    const payloadJson = JSON.stringify(payload);
    const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const payloadB64 = b64(new TextEncoder().encode(payloadJson));
    const sig = await crypto.subtle.sign('Ed25519', kp.privateKey, new TextEncoder().encode(payloadB64));
    const sigB64 = b64(new Uint8Array(sig));
    const key = `AURA1.${payloadB64}.${sigB64}`;
    expect(decodeLicenseKey(key)).toEqual({ payloadB64, signatureB64: sigB64 });

    const { db, e } = engine({ verifier: new LicenseVerifier(pubJwk) });
    const res = await e.activate(key);
    expect(res.ok).toBe(true);
    expect(res.state.mode).toBe('licensed');
    expect(res.state.plan).toBe('lifetime');
    expect(e.hasFeature(e.entitlements(), 'agent.tasks')).toBe(true);
    expect(e.hasFeature(e.entitlements(), 'voice.live')).toBe(false);

    // Tampered payload must fail.
    const tampered = `AURA1.${b64(new TextEncoder().encode(payloadJson.replace('agent.tasks', 'agent.computer_control')))}.${sigB64}`;
    const bad = await e.activate(tampered);
    expect(bad.ok).toBe(false);
    expect(bad.message).toMatch(/signature is invalid/i);

    e.deactivate();
    expect(e.licenseState().mode).toBe('unlicensed');
    db.close();
  });

  it('rejects licenses bound to another device', async () => {
    const kp = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
    const pubJwk = await crypto.subtle.exportKey('jwk', kp.publicKey);
    const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const payloadB64 = b64(new TextEncoder().encode(JSON.stringify({ v: 1, kind: 'license', plan: 'lifetime', subject: 'x', features: ['agent.tasks'], deviceId: 'OTHER_DEVICE', issuedAt: new Date().toISOString(), expiresAt: null, licenseKeyHint: 'h' })));
    const sig = await crypto.subtle.sign('Ed25519', kp.privateKey, new TextEncoder().encode(payloadB64));
    const { db, e } = engine({ verifier: new LicenseVerifier(pubJwk) });
    const res = await e.activate(`AURA1.${payloadB64}.${b64(new Uint8Array(sig))}`);
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/bound to a different device/);
    db.close();
  });

  it('treats an expired license as expired, not active', async () => {
    const db = freshDb();
    const repo = new LicenseRepo(db.driver);
    repo.save({ kind: 'license', status: 'active', plan: 'trial', subject: 'x', licenseKeyHint: null, deviceId: 'd', issuedAt: '2020-01-01T00:00:00.000Z', expiresAt: '2020-02-01T00:00:00.000Z', features: ['agent.tasks'], signature: null, payload: {}, source: 'offline' });
    const e = new LicensingEngine(repo, { devMode: false, deviceId: 'd', verifier: new LicenseVerifier(null) });
    expect(e.licenseState().mode).toBe('expired');
    expect(e.hasFeature(e.entitlements(), 'agent.tasks')).toBe(false);
    db.close();
  });

  it('reports subscription independently of the lifetime license', () => {
    const db = freshDb();
    const repo = new LicenseRepo(db.driver);
    const e = new LicensingEngine(repo, { devMode: false, deviceId: 'd', verifier: new LicenseVerifier(null) });
    expect(e.subscriptionState().status).toBe('none');
    expect(e.subscriptionState().reason).toMatch(/own provider API keys/);
    repo.save({ kind: 'subscription', status: 'active', plan: 'cloud-pro', subject: null, licenseKeyHint: null, deviceId: 'd', issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86400000).toISOString(), features: ['managed.models'], signature: null, payload: { quotaTokensPerMonth: 2_000_000 }, source: 'remote' });
    const sub = e.subscriptionState();
    expect(sub.status).toBe('active');
    expect(sub.quotaTokensPerMonth).toBe(2_000_000);
    // Lifetime license state is unaffected by subscription.
    expect(e.licenseState().mode).toBe('unlicensed');
    db.close();
  });
});
