/**
 * Browser Supabase client.
 *
 * The anon key is the only credential that ever reaches the browser. Authorization is
 * enforced by Postgres RLS policies (see supabase/migrations/0006_policies.sql), not by
 * this module and not by UI guards.
 *
 * The client is created lazily and cached, and `getSupabase()` returns null when the
 * project is not configured so callers can render an honest "not configured" state
 * instead of pretending to be connected.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { PUBLIC_ENV } from "@/lib/config/env";

let cached: SupabaseClient | null = null;
let attempted = false;

export function getSupabase(): SupabaseClient | null {
  if (attempted) return cached;
  attempted = true;
  if (!PUBLIC_ENV.supabaseUrl || !PUBLIC_ENV.supabaseAnonKey) {
    cached = null;
    return null;
  }
  cached = createClient(PUBLIC_ENV.supabaseUrl, PUBLIC_ENV.supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: "domainfits.auth",
    },
    global: { headers: { "x-client-info": "domainfits-web" } },
  });
  return cached;
}

export function isSupabaseConfigured(): boolean {
  return Boolean(PUBLIC_ENV.supabaseUrl && PUBLIC_ENV.supabaseAnonKey);
}

/** Human-readable explanation used by admin screens when the project is missing. */
export const NOT_CONFIGURED_MESSAGE =
  "Supabase is not configured for this build. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY, apply supabase/migrations, then rebuild. Until then the admin area intentionally refuses to operate rather than pretending to save data.";
