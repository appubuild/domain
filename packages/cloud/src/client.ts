import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/** Only public browser keys are accepted; a service-role key must never enter the client. */
export function isPublicConfiguration(url: string, key: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || !/^[a-z0-9-]+\.supabase\.co$/.test(parsed.hostname) || parsed.username || parsed.password || parsed.port || parsed.pathname !== '/' || parsed.search || parsed.hash) return false;
    if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) return true;
    const parts = key.split('.');
    if (parts.length !== 3) return false;
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const claims = JSON.parse(atob(payload.padEnd(Math.ceil(payload.length / 4) * 4, '='))) as { role?: unknown };
    return claims.role === 'anon';
  } catch { return false; }
}
let instance: SupabaseClient | null | undefined;
export function getCloudClient(): SupabaseClient | null {
  if (instance !== undefined) return instance;
  const url = import.meta.env.VITE_SUPABASE_URL ?? '';
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY ?? '';
  instance = isPublicConfiguration(url, key) ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: true, detectSessionInUrl: true } }) : null;
  return instance;
}
