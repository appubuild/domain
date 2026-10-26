"use client";

import { useCallback, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase/client";

export type AdminSessionState = {
  status: "loading" | "unconfigured" | "signed-out" | "signed-in" | "forbidden";
  session: Session | null;
  email: string | null;
  isAdmin: boolean;
  error: string | null;
};

/**
 * Session + role state for the admin area.
 *
 * `isAdmin` is derived from the database (`is_admin()`), never from a client-side list.
 * Even if this returned true incorrectly, RLS would still block every mutation — the UI
 * check exists to render the right screens, not to authorize actions.
 */
export function useAdminSession() {
  const [state, setState] = useState<AdminSessionState>({
    status: isSupabaseConfigured() ? "loading" : "unconfigured",
    session: null,
    email: null,
    isAdmin: false,
    error: null,
  });

  const evaluate = useCallback(async (session: Session | null) => {
    if (!session) {
      setState({ status: "signed-out", session: null, email: null, isAdmin: false, error: null });
      return;
    }
    const supabase = getSupabase();
    if (!supabase) {
      setState({ status: "unconfigured", session: null, email: null, isAdmin: false, error: null });
      return;
    }
    const { data, error } = await supabase.rpc("is_admin");
    if (error) {
      setState({
        status: "forbidden",
        session,
        email: session.user.email ?? null,
        isAdmin: false,
        error: `Role check failed: ${error.message}`,
      });
      return;
    }
    setState({
      status: data === true ? "signed-in" : "forbidden",
      session,
      email: session.user.email ?? null,
      isAdmin: data === true,
      error: null,
    });
  }, []);

  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase) return;

    void supabase.auth.getSession().then(({ data }) => {
      void evaluate(data.session);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      void evaluate(session);
    });

    return () => subscription.subscription.unsubscribe();
  }, [evaluate]);

  const signIn = useCallback(async (email: string, password: string): Promise<string | null> => {
    const supabase = getSupabase();
    if (!supabase) return "Supabase is not configured for this build.";
    setState((current) => ({ ...current, status: "loading", error: null }));
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setState({ status: "signed-out", session: null, email: null, isAdmin: false, error: error.message });
      return error.message;
    }
    await evaluate(data.session);
    return null;
  }, [evaluate]);

  const signOut = useCallback(async () => {
    const supabase = getSupabase();
    if (!supabase) return;
    await supabase.auth.signOut();
    setState({ status: "signed-out", session: null, email: null, isAdmin: false, error: null });
  }, []);

  return { ...state, signIn, signOut };
}
