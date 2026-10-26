"use client";

import { useCallback, useEffect, useState } from "react";
import { ShieldCheck, UserMinus, UserPlus } from "lucide-react";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase/client";
import { useAdminSession } from "@/lib/auth/use-session";
import { Badge, Button, Callout, Card, EmptyState, Field, Input, Select, Skeleton, useToast } from "@/components/ui";
import { formatDateTime } from "@/lib/utils/format";

type Role = { id: string; name: string; description: string; rank: number };
type Member = {
  user_id: string;
  display_name: string;
  role_id: string;
  role_name: string;
  granted_at: string;
};
type Profile = { user_id: string; display_name: string; created_at: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Users and roles.
 *
 * Role assignment is a database write protected by RLS (`user_roles` is admin-only).
 * Privilege escalation is possible by design only for existing admins; the UI cannot
 * grant itself anything the policies reject.
 */
export default function AdminUsersPage() {
  const configured = isSupabaseConfigured();
  const { session } = useAdminSession();
  const { push } = useToast();
  const [roles, setRoles] = useState<Role[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [userId, setUserId] = useState("");
  const [roleId, setRoleId] = useState("admin");
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  const load = useCallback(async () => {
    const supabase = getSupabase();
    if (!supabase) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const [roleResult, memberResult, profileResult] = await Promise.all([
      supabase.from("app_roles").select("id,name,description,rank").order("rank", { ascending: false }),
      supabase.from("user_roles").select("user_id,role_id,granted_at").order("granted_at", { ascending: false }),
      supabase.from("user_profiles").select("user_id,display_name,created_at").order("created_at", { ascending: false }).limit(100),
    ]);

    const firstError = roleResult.error ?? memberResult.error ?? profileResult.error;
    if (firstError) {
      setError(firstError.message);
      setLoading(false);
      return;
    }

    const roleList = (roleResult.data ?? []) as Role[];
    setRoles(roleList);
    const roleNames = new Map(roleList.map((role) => [role.id, role.name]));
    setMembers(
      ((memberResult.data ?? []) as Array<{ user_id: string; role_id: string; granted_at: string }>).map((row) => ({
        user_id: row.user_id,
        display_name: "",
        role_id: row.role_id,
        role_name: roleNames.get(row.role_id) ?? row.role_id,
        granted_at: row.granted_at,
      })),
    );
    setProfiles((profileResult.data ?? []) as Profile[]);
    setError(null);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const grant = async () => {
    const supabase = getSupabase();
    if (!supabase) return;
    if (!UUID.test(userId.trim())) {
      push({ tone: "error", title: "Invalid user ID", description: "A user ID is a UUID from the Supabase Auth users table." });
      return;
    }
    setBusy(true);
    try {
      const { error: grantError } = await supabase.from("user_roles").insert({
        user_id: userId.trim(),
        role_id: roleId,
        granted_by: session?.user.id ?? null,
      });
      if (grantError) throw grantError;
      await supabase.from("audit_logs").insert({
        action: "create",
        entity_type: "user_roles",
        entity_id: userId.trim(),
        summary: `Granted role ${roleId}`,
        payload: { role_id: roleId },
      });
      push({ tone: "success", title: `Role ${roleId} granted` });
      setUserId("");
      await load();
    } catch (grantError) {
      push({ tone: "error", title: "Could not grant role", description: (grantError as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (row: Member) => {
    const supabase = getSupabase();
    if (!supabase) return;
    if (row.user_id === session?.user.id && row.role_id === "admin") {
      const admins = members.filter((member) => member.role_id === "admin").length;
      if (admins <= 1) {
        push({
          tone: "error",
          title: "Refusing to remove the last administrator",
          description: "Grant another account the admin role first, or you will lock everyone out of this panel.",
        });
        return;
      }
    }
    setRemoving(`${row.user_id}:${row.role_id}`);
    try {
      const { error: revokeError } = await supabase
        .from("user_roles")
        .delete()
        .eq("user_id", row.user_id)
        .eq("role_id", row.role_id);
      if (revokeError) throw revokeError;
      await supabase.from("audit_logs").insert({
        action: "delete",
        entity_type: "user_roles",
        entity_id: row.user_id,
        summary: `Revoked role ${row.role_id}`,
        payload: {},
      });
      push({ tone: "success", title: `Role ${row.role_id} revoked` });
      await load();
    } catch (revokeError) {
      push({ tone: "error", title: "Could not revoke role", description: (revokeError as Error).message });
    } finally {
      setRemoving(null);
    }
  };

  if (!configured) {
    return (
      <Callout tone="warn" title="No database connection">
        Roles live in the database. Configure Supabase to manage access.
      </Callout>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Users &amp; roles</h1>
        <p className="mt-1 max-w-2xl text-[13px] text-fg-muted">
          Accounts sign in through the auth provider. Only an existing administrator can grant roles, and the
          database policies re-check that on every write.
        </p>
      </div>

      {error ? (
        <Callout tone="danger" title="Could not load roles">
          {error}
          <p className="mt-1 text-[11px]">Only administrators may read role assignments.</p>
        </Callout>
      ) : null}

      <Card className="p-4">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold">
          <UserPlus className="size-4" aria-hidden="true" /> Grant a role
        </h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto] sm:items-end">
          <Field label="User ID" htmlFor="grant-user" description="Find it under Authentication → Users in the Supabase dashboard.">
            <Input
              id="grant-user"
              value={userId}
              onChange={(event) => setUserId(event.target.value)}
              placeholder="00000000-0000-0000-0000-000000000000"
              className="font-mono text-[12px]"
            />
          </Field>
          <Field label="Role" htmlFor="grant-role">
            <Select id="grant-role" value={roleId} onChange={(event) => setRoleId(event.target.value)}>
              {roles.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.name}
                </option>
              ))}
            </Select>
          </Field>
          <Button onClick={() => void grant()} loading={busy} className="mb-0.5">
            Grant
          </Button>
        </div>
      </Card>

      <Card className="p-4">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold">
          <ShieldCheck className="size-4" aria-hidden="true" /> Role assignments
        </h2>
        {loading ? (
          <div className="mt-3 space-y-2">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-8" />
            ))}
          </div>
        ) : members.length === 0 ? (
          <EmptyState
            className="mt-3 border-0 py-8"
            title="No roles assigned"
            description="Grant the first administrator using the form above, then sign in again."
          />
        ) : (
          <table className="mt-3 w-full text-left text-[12.5px]">
            <thead>
              <tr className="border-b border-border text-[10.5px] uppercase tracking-wide text-fg-subtle">
                <th className="py-1.5">User</th>
                <th className="py-1.5">Role</th>
                <th className="py-1.5">Granted</th>
                <th className="py-1.5 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {members.map((member) => {
                const key = `${member.user_id}:${member.role_id}`;
                const you = member.user_id === session?.user.id;
                return (
                  <tr key={key} className="border-b border-border last:border-b-0">
                    <td className="py-2 font-mono text-[11.5px] text-fg-muted">
                      {member.user_id.slice(0, 8)}…{member.user_id.slice(-4)}
                      {you ? <span className="ml-1.5 text-accent">(you)</span> : null}
                    </td>
                    <td className="py-2">
                      <Badge tone={member.role_id === "admin" ? "accent" : "neutral"}>{member.role_name}</Badge>
                    </td>
                    <td className="py-2 text-fg-subtle">{formatDateTime(member.granted_at)}</td>
                    <td className="py-2 text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void revoke(member)}
                        loading={removing === key}
                        aria-label={`Revoke ${member.role_id} from ${member.user_id}`}
                      >
                        <UserMinus className="size-3.5" /> Revoke
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      <Card className="p-4">
        <h2 className="text-sm font-semibold">Recent accounts</h2>
        <p className="mt-1 text-[11px] text-fg-subtle">
          From <code>user_profiles</code> — populated when an account first signs in. Email addresses are not
          copied into app tables on purpose.
        </p>
        {profiles.length === 0 ? (
          <p className="mt-3 text-[12px] text-fg-subtle">No profiles yet.</p>
        ) : (
          <ul className="mt-2 space-y-1">
            {profiles.map((profile) => (
              <li key={profile.user_id} className="flex items-center justify-between gap-2 text-[12px]">
                <span className="truncate text-fg">{profile.display_name || profile.user_id.slice(0, 8)}</span>
                <span className="text-fg-subtle">{formatDateTime(profile.created_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
