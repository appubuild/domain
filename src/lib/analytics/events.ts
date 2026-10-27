"use client";

/**
 * First-party analytics.
 *
 * There is no third-party tracker in this application. Events are written to
 * `analytics_events` through the public Supabase client, where RLS allows inserts from the
 * browser but no bulk reads (see `0006_policies.sql`). The admin dashboard aggregates them.
 *
 * Contract:
 *  - `recordEvent` never throws into the UI path that triggered it.
 *  - It reports **whether the event was actually stored**. When Supabase is not configured
 *    the answer is `{ recorded: false, reason: "not-configured" }` — the admin analytics page
 *    therefore shows real counts or nothing, never estimates.
 *  - Payloads are flat, small and contain no personal data: no IP, no user agent, no email.
 *    `session_hash` is a random per-tab id, not a fingerprint.
 */

import { PUBLIC_ENV } from "@/lib/config/env";

/**
 * The event vocabulary, as a value rather than only a type.
 *
 * The database CHECK constraint lists the same names. Having the list here means the
 * instrumentation table (`EVENT_CATALOG` in `./report`) can be checked against it: an event
 * added to one and forgotten in the other fails a test instead of silently never being
 * emitted, which is exactly how three of these went uncounted for several phases.
 */
export const EVENT_TYPES = [
  "generation_run",
  "filter_applied",
  "export_created",
  "favorite_added",
  "availability_check",
  "availability_failure",
  "affiliate_click",
  "page_view",
  "signup",
  "login",
  "ai_generation",
] as const;

export type AppEventType = (typeof EVENT_TYPES)[number];

export type RecordOutcome = {
  recorded: boolean;
  reason?: "not-configured" | "error";
  error?: string;
};

const SESSION_KEY = "domainfits.analytics.session";
let sessionHash: string | null = null;

function getSessionHash(): string | null {
  if (typeof window === "undefined") return null;
  if (sessionHash) return sessionHash;
  try {
    const existing = window.sessionStorage.getItem(SESSION_KEY);
    if (existing) {
      sessionHash = existing;
      return sessionHash;
    }
    const generated =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID().replace(/-/g, "").slice(0, 24)
        : Math.random().toString(36).slice(2, 26);
    window.sessionStorage.setItem(SESSION_KEY, generated);
    sessionHash = generated;
    return sessionHash;
  } catch {
    return null;
  }
}

/** Keeps payloads small and flat; nested or oversized values are stringified/truncated. */
function sanitizePayload(input: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!input) return {};
  const output: Record<string, unknown> = {};
  let count = 0;
  for (const [key, value] of Object.entries(input)) {
    if (count >= 20) break;
    if (value === null || value === undefined) continue;
    if (typeof value === "number" || typeof value === "boolean") {
      output[key] = value;
    } else if (typeof value === "string") {
      output[key] = value.slice(0, 200);
    } else if (Array.isArray(value)) {
      output[key] = value.slice(0, 12).map((item) => (typeof item === "string" ? item.slice(0, 60) : String(item)));
    } else {
      output[key] = "omitted";
    }
    count += 1;
  }
  return output;
}

export type RecordEventInput = {
  path?: string;
  payload?: Record<string, unknown>;
  /** Injectable sink for tests; defaults to the Supabase client. */
  sink?: (row: { event_type: AppEventType; path: string; payload: Record<string, unknown>; session_hash: string | null }) => Promise<{ error: { message: string } | null }>;
};

export async function recordEvent(type: AppEventType, input: RecordEventInput = {}): Promise<RecordOutcome> {
  const row = {
    event_type: type,
    path: (input.path ?? (typeof window !== "undefined" ? window.location.pathname : "")).slice(0, 300),
    payload: sanitizePayload(input.payload),
    session_hash: getSessionHash(),
  };

  if (input.sink) {
    try {
      const { error } = await input.sink(row);
      return error ? { recorded: false, reason: "error", error: error.message } : { recorded: true };
    } catch (error) {
      return { recorded: false, reason: "error", error: (error as Error).message };
    }
  }

  if (!isAnalyticsWritable()) {
    return { recorded: false, reason: "not-configured" };
  }

  try {
    // Imported lazily: the generator page must not pay ~40 kB of Supabase client for a
    // fire-and-forget counter. The chunk is only fetched when an event is actually sent.
    const { getSupabase } = await import("@/lib/supabase/client");
    const supabase = getSupabase();
    if (!supabase) return { recorded: false, reason: "not-configured" };
    const { error } = await supabase.from("analytics_events").insert(row);
    if (error) return { recorded: false, reason: "error", error: error.message };
    return { recorded: true };
  } catch (error) {
    return { recorded: false, reason: "error", error: (error as Error).message };
  }
}

/** Fire-and-forget variant for UI handlers where the outcome is not worth a toast. */
export function trackEvent(type: AppEventType, input: RecordEventInput = {}): void {
  void recordEvent(type, input).catch(() => {
    /* never surface analytics failures to the user */
  });
}

/** True when events can actually be stored in this build. */
export function isAnalyticsWritable(): boolean {
  return Boolean(PUBLIC_ENV.supabaseUrl && PUBLIC_ENV.supabaseAnonKey);
}
