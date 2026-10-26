/**
 * Public runtime configuration.
 *
 * The app is a static export, so **only** `NEXT_PUBLIC_*` values exist in the browser.
 * Nothing here may contain a secret: service-role keys, AI keys and registrar API keys
 * live only in Supabase Edge Function secrets (see `docs/deployment.md`).
 */

export type DataBackend = "supabase" | "local";

export type PublicEnv = {
  appUrl: string;
  siteName: string;
  sandboxMode: boolean;
  supabaseUrl: string | null;
  supabaseAnonKey: string | null;
  /** Backend used by the data layer. `supabase` requires URL + anon key. */
  dataBackend: DataBackend;
  /** Optional URL of the deployed availability Edge Function. */
  availabilityFunctionUrl: string | null;
  /** Explicitly opt in to the browser-local Postgres demo store. */
  allowLocalStore: boolean;
  buildCommit: string;
};

function readPublic(name: string): string | null {
  // Next.js inlines NEXT_PUBLIC_* at build time; referencing them statically is required.
  switch (name) {
    case "NEXT_PUBLIC_APP_URL":
      return process.env.NEXT_PUBLIC_APP_URL ?? null;
    case "NEXT_PUBLIC_SITE_NAME":
      return process.env.NEXT_PUBLIC_SITE_NAME ?? null;
    case "NEXT_PUBLIC_SUPABASE_URL":
      return process.env.NEXT_PUBLIC_SUPABASE_URL ?? null;
    case "NEXT_PUBLIC_SUPABASE_ANON_KEY":
      return process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? null;
    case "NEXT_PUBLIC_DATA_BACKEND":
      return process.env.NEXT_PUBLIC_DATA_BACKEND ?? null;
    case "NEXT_PUBLIC_AVAILABILITY_FN_URL":
      return process.env.NEXT_PUBLIC_AVAILABILITY_FN_URL ?? null;
    case "NEXT_PUBLIC_ALLOW_LOCAL_STORE":
      return process.env.NEXT_PUBLIC_ALLOW_LOCAL_STORE ?? null;
    case "NEXT_PUBLIC_BUILD_COMMIT":
      return process.env.NEXT_PUBLIC_BUILD_COMMIT ?? null;
    default:
      return null;
  }
}

function isHttpUrl(value: string | null): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

/** Resolves the effective public configuration. Safe to call during static build. */
export function getPublicEnv(): PublicEnv {
  const supabaseUrl = readPublic("NEXT_PUBLIC_SUPABASE_URL");
  const supabaseAnonKey = readPublic("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const requested = readPublic("NEXT_PUBLIC_DATA_BACKEND");
  const allowLocalStore = readPublic("NEXT_PUBLIC_ALLOW_LOCAL_STORE") === "true";

  const supabaseConfigured = isHttpUrl(supabaseUrl) && Boolean(supabaseAnonKey);

  let dataBackend: DataBackend;
  if (requested === "local" && allowLocalStore) {
    dataBackend = "local";
  } else if (supabaseConfigured) {
    dataBackend = "supabase";
  } else {
    // No configuration: fall back to the local store only when explicitly allowed.
    // Otherwise the UI renders honest "not configured" states instead of fake data.
    dataBackend = allowLocalStore ? "local" : "supabase";
  }

  const appUrl = readPublic("NEXT_PUBLIC_APP_URL");

  return {
    appUrl: isHttpUrl(appUrl) ? (appUrl as string).replace(/\/$/, "") : "",
    siteName: readPublic("NEXT_PUBLIC_SITE_NAME") || "DomainFits",
    sandboxMode: !supabaseConfigured,
    supabaseUrl: supabaseConfigured ? supabaseUrl : null,
    supabaseAnonKey: supabaseConfigured ? supabaseAnonKey : null,
    dataBackend,
    availabilityFunctionUrl: isHttpUrl(readPublic("NEXT_PUBLIC_AVAILABILITY_FN_URL"))
      ? readPublic("NEXT_PUBLIC_AVAILABILITY_FN_URL")
      : null,
    allowLocalStore,
    buildCommit: readPublic("NEXT_PUBLIC_BUILD_COMMIT") || "dev",
  };
}

/** True when the data layer can actually persist and read records. */
export function isDataLayerReady(env: PublicEnv): boolean {
  return env.dataBackend === "local" ? env.allowLocalStore : env.supabaseUrl !== null;
}

export const PUBLIC_ENV = getPublicEnv();
