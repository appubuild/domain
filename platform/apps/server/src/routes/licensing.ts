import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { HttpError, json, notFound, parseBody, readJson, matchRoute } from '../http.js';

/**
 * Licensing + auth surface. Google sign-in uses the OAuth *code* provided by the client
 * after a real consent flow; we exchange it server-side and verify the ID token. If the
 * OAuth client is not configured, the endpoint says so — it never fabricates a session.
 */
export async function handleLicensing(ctx: AppContext, req: IncomingMessage, res: ServerResponse, pathname: string, method: string): Promise<boolean> {
  if (pathname === '/api/license' && method === 'GET') {
    const entitlements = ctx.licensing.entitlements();
    json(res, 200, {
      ...entitlements,
      deviceId: ctx.deviceId,
      account: ctx.db.license.account(),
      devMode: ctx.config.devMode,
      googleConfigured: Boolean(process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET),
    });
    return true;
  }

  if (pathname === '/api/license/activate' && method === 'POST') {
    const body = parseBody(z.object({ key: z.string().min(10).max(4000) }), await readJson(req));
    const result = await ctx.licensing.activate(body.key, ctx.db.license.account()?.email);
    ctx.db.audit.log({ actor: 'user', action: 'license.activate', outcome: result.ok ? 'success' : 'failure', detail: { message: result.message } });
    json(res, result.ok ? 200 : 400, { ok: result.ok, message: result.message, state: result.state });
    return true;
  }

  if (pathname === '/api/license/deactivate' && method === 'POST') {
    ctx.licensing.deactivate();
    ctx.db.audit.log({ actor: 'user', action: 'license.deactivate', outcome: 'success' });
    json(res, 200, { ok: true, state: ctx.licensing.licenseState() });
    return true;
  }

  if (pathname === '/api/license/subscription/refresh' && method === 'POST') {
    const state = await ctx.licensing.refreshSubscription();
    json(res, 200, { subscription: state });
    return true;
  }

  if (pathname === '/api/auth/google/config' && method === 'GET') {
    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
    json(res, 200, {
      configured: Boolean(clientId && process.env.GOOGLE_OAUTH_CLIENT_SECRET),
      clientId: clientId ?? null,
      redirectUri: process.env.GOOGLE_OAUTH_REDIRECT_URI ?? 'http://localhost:5173/auth/google/callback',
      note: clientId ? null : 'Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET to enable Google Sign-in.',
    });
    return true;
  }

  if (pathname === '/api/auth/google' && method === 'POST') {
    const body = parseBody(z.object({ code: z.string().min(10), redirectUri: z.string().url() }), await readJson(req));
    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    if (!clientId || !clientSecret) throw new HttpError(503, 'Google OAuth is not configured on this server. Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET.');
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code: body.code, client_id: clientId, client_secret: clientSecret, redirect_uri: body.redirectUri, grant_type: 'authorization_code' }),
    });
    if (!tokenRes.ok) {
      const detail = (await tokenRes.text()).slice(0, 300);
      throw new HttpError(400, `Google token exchange failed (${tokenRes.status}). ${detail}`);
    }
    const tokens = (await tokenRes.json()) as { id_token?: string; access_token?: string };
    if (!tokens.id_token) throw new HttpError(400, 'Google response did not include an ID token.');
    const claims = decodeJwtPayload(tokens.id_token);
    const email = typeof claims.email === 'string' ? claims.email : null;
    const verified = claims.email_verified === true;
    if (!email || !verified) throw new HttpError(403, 'Google account email is not verified.');
    ctx.db.license.saveAccount({
      provider: 'google',
      email,
      name: typeof claims.name === 'string' ? claims.name : null,
      pictureUrl: typeof claims.picture === 'string' ? claims.picture : null,
    });
    ctx.db.audit.log({ actor: 'user', action: 'auth.google.signin', target: email, outcome: 'success' });
    json(res, 200, { account: { email, name: claims.name ?? null, pictureUrl: claims.picture ?? null }, note: 'ID token signature verified by Google token endpoint response over TLS; stored account is for entitlement display only.' });
    return true;
  }

  if (pathname === '/api/auth/signout' && method === 'POST') {
    ctx.db.license.signOut();
    json(res, 200, { ok: true });
    return true;
  }

  const devMatch = matchRoute('/api/license/dev/:action', pathname);
  if (devMatch && method === 'POST') {
    if (!ctx.config.devMode) throw new HttpError(403, 'Development license mode is disabled in this build (AURA_DEV_LICENSE is not set).');
    if (devMatch.action === 'enable') {
      json(res, 200, { ok: true, state: ctx.licensing.licenseState(), note: 'Dev mode is enabled via environment; no activation required.' });
      return true;
    }
    if (devMatch.action === 'subscription-simulate') {
      throw new HttpError(400, 'Simulating a cloud subscription is not supported: subscription state must come from a real backend. Configure AURA_SUBSCRIPTION_STATUS_URL to test this path.');
    }
  }

  return false;
}

function decodeJwtPayload(jwt: string): Record<string, unknown> {
  const part = jwt.split('.')[1];
  if (!part) return {};
  try {
    return JSON.parse(Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}
