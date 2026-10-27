import type { Metadata, Viewport } from "next";
import { BRAND_DEFAULTS } from "@/lib/config/site";
import { loadSiteContent } from "@/lib/content/source";
import { PUBLIC_ENV } from "@/lib/config/env";
import { ThemeProvider, themeBootstrapScript } from "@/components/theme/theme-provider";
import { ToastProvider } from "@/components/ui/overlay";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { PageViewCounter } from "@/components/analytics/page-view-counter";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: PUBLIC_ENV.appUrl ? new URL(PUBLIC_ENV.appUrl) : undefined,
  title: {
    default: `${BRAND_DEFAULTS.name} — ${BRAND_DEFAULTS.tagline}`,
    template: `%s · ${BRAND_DEFAULTS.name}`,
  },
  description: BRAND_DEFAULTS.description,
  applicationName: BRAND_DEFAULTS.name,
  robots: { index: true, follow: true },
  formatDetection: { telephone: false, address: false, email: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fbfbf9" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0c0f" },
  ],
};

/**
 * Root layout.
 *
 * Navigation is resolved once, at build time: `loadSiteContent()` reads `nav_menus`/
 * `nav_items` and falls back to the code defaults when the database has nothing usable.
 * Because this is a static export, the menu is baked into every page — changing it means
 * rebuilding, which the admin panel says plainly.
 */
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const content = await loadSiteContent();

  return (
    <html lang="en" data-theme="light" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrapScript }} />
      </head>
      <body>
        {/* First-party page counter: one row per public page load, nothing else. */}
        <PageViewCounter />
        <ThemeProvider>
          <ToastProvider>
            <a
              href="#main"
              className="sr-only-focusable absolute left-3 top-3 z-50 rounded-[var(--radius)] bg-accent px-3 py-2 text-sm font-medium text-accent-fg"
            >
              Skip to content
            </a>
            <div className="flex min-h-dvh flex-col">
              <SiteHeader brand={content.settings.brand} items={content.navigation.primary} />
              <main id="main" className="flex-1">
                {children}
              </main>
              <SiteFooter brand={content.settings.brand} columns={content.navigation.footer} />
            </div>
          </ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
