import { AdminShell } from "@/components/admin/admin-shell";

/**
 * Protected admin routes.
 *
 * `AdminShell` renders the sidebar and the session/role gate. The gate is convenience:
 * the real boundary is the RLS policies applied in Postgres, which reject admin queries
 * from anyone without an admin role even if this component were bypassed.
 */
export default function ProtectedAdminLayout({ children }: { children: React.ReactNode }) {
  return <AdminShell>{children}</AdminShell>;
}
