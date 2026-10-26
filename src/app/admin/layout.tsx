import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Administration",
  // Admin surfaces must never be indexed, linked from public pages or included in sitemaps.
  robots: { index: false, follow: false, nocache: true },
};

export default function AdminRootLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-[70dvh]">{children}</div>;
}
