import type { Metadata } from "next";
import { Suspense } from "react";
import { ContentEditor } from "@/components/admin/content-editor";
import { Skeleton } from "@/components/ui";

/**
 * Full-page content editor.
 *
 * One route serves both posts and pages; `?type=post|page&slug=…` decides which. The query string
 * is read on the client because the site is a static export — there is no server at request time
 * to read search params, and generating a page per slug would bake the draft list into the build,
 * which is exactly what the admin panel exists to avoid.
 */
export const metadata: Metadata = {
  title: "Editor · Admin",
  robots: { index: false, follow: false, nocache: true },
};

export default function ContentEditorPage() {
  return (
    <Suspense
      fallback={
        <div className="space-y-3 p-6" aria-busy="true">
          <Skeleton className="h-9 w-64" />
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-64 w-full" />
        </div>
      }
    >
      <ContentEditor />
    </Suspense>
  );
}
