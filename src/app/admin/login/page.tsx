"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { LogIn } from "lucide-react";
import { useAdminSession } from "@/lib/auth/use-session";
import { Button, Callout, Input } from "@/components/ui";

export default function AdminLoginPage() {
  const router = useRouter();
  const { signIn, status, error } = useAdminSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const unconfigured = status === "unconfigured";

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLocalError(null);
    if (!email || !password) {
      setLocalError("Enter your email address and password.");
      return;
    }
    setBusy(true);
    const message = await signIn(email, password);
    setBusy(false);
    if (message) {
      setLocalError(message);
      return;
    }
    router.replace("/admin/");
  };

  return (
    <div className="mx-auto w-full max-w-sm px-4 py-16">
      <h1 className="text-xl font-semibold tracking-tight">Administrator sign in</h1>
      <p className="mt-1 text-[13px] text-fg-muted">
        Accounts are managed by Supabase Auth. Access requires an administrator role in the database.
      </p>

      {unconfigured ? (
        <Callout tone="warn" className="mt-5" title="Supabase is not configured">
          This build has no auth provider, so sign-in is unavailable. Configure{" "}
          <code>NEXT_PUBLIC_SUPABASE_URL</code> and <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code>, apply the
          migrations, and rebuild. No credentials are accepted here and nothing is simulated.
        </Callout>
      ) : (
        <form onSubmit={submit} className="mt-6 space-y-3">
          <div className="space-y-1">
            <label htmlFor="email" className="text-[12px] font-medium text-fg">
              Email
            </label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="password" className="text-[12px] font-medium text-fg">
              Password
            </label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </div>

          {localError || error ? (
            <p role="alert" className="text-[12px] font-medium text-danger">
              {localError ?? error}
            </p>
          ) : null}

          <Button type="submit" className="w-full" loading={busy}>
            <LogIn className="size-4" aria-hidden="true" /> Sign in
          </Button>
          <p className="text-[11px] leading-relaxed text-fg-subtle">
            Sessions are stored by the auth provider with httpOnly-compatible cookies and short-lived tokens.
            Failed attempts are rate-limited by the provider.
          </p>
        </form>
      )}

      <p className="mt-6 text-[11px] text-fg-subtle">
        <Link href="/" className="underline hover:text-fg">
          Return to the public site
        </Link>
      </p>
    </div>
  );
}
