"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  Filter,
  Info,
  RefreshCw,
  ScanSearch,
  XCircle,
} from "lucide-react";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase/client";
import { FOOTER_NAV, PRIMARY_NAV } from "@/lib/config/site";
import { PUBLIC_ENV } from "@/lib/config/env";
import {
  SEVERITY_LABEL,
  SEVERITY_MEANING,
  codeLabel,
  runDiagnostics,
  type DiagnosticReport,
  type RedirectRecord,
  type SeoRecord,
  type Severity,
} from "@/lib/seo/diagnostics";
import { Badge, Button, Callout, Card, EmptyState, Input, Select, Skeleton, StatTile, useToast } from "@/components/ui";

/**
 * SEO diagnostics.
 *
 * The screen fetches real rows and hands them to `runDiagnostics`. It computes nothing about
 * rankings: there is no score, no "health percentage", and no recommendation engine. What it
 * shows is a list of conditions that can be verified against the content itself, each with
 * the exact row to edit.
 *
 * When a data source is unavailable the screen says so and shows nothing, rather than an
 * empty report that would read as "all clear".
 */

type SeverityFilter = "all" | Severity;

const SEVERITY_ICON: Record<Severity, React.ReactNode> = {
  error: <XCircle className="size-4 text-danger" aria-hidden="true" />,
  warning: <AlertTriangle className="size-4 text-warn" aria-hidden="true" />,
  notice: <Info className="size-4 text-info" aria-hidden="true" />,
};

const SEVERITY_TONE: Record<Severity, "danger" | "warn" | "info"> = {
  error: "danger",
  warning: "warn",
  notice: "info",
};

export default function AdminSeoPage() {
  const { push } = useToast();
  const configured = isSupabaseConfigured();

  const [report, setReport] = useState<DiagnosticReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [severity, setSeverity] = useState<SeverityFilter>("all");
  const [code, setCode] = useState("all");
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    const supabase = getSupabase();
    if (!supabase) {
      setLoading(false);
      return;
    }
    setLoading(true);

    const recordColumns =
      "id,slug,title,body,excerpt,seo_title,meta_description,canonical_url,noindex,cover_image_url,cover_image_alt,published_at,status,updated_at";

    const [pagesResult, postsResult, redirectsResult, industriesResult, navResult] = await Promise.all([
      supabase.from("pages").select(recordColumns).limit(1000),
      supabase.from("posts").select(recordColumns).limit(1000),
      supabase.from("redirects").select("id,source_path,target_path,status_code,enabled").limit(1000),
      supabase.from("industries").select("slug").limit(1000),
      supabase.from("nav_items").select("href").limit(1000),
    ]);

    // Partial failure is reported honestly: a rule that never ran must not read as a pass.
    const missing: string[] = [];
    if (pagesResult.error) missing.push(`pages (${pagesResult.error.message})`);
    if (postsResult.error) missing.push(`posts (${postsResult.error.message})`);
    if (redirectsResult.error) missing.push(`redirects (${redirectsResult.error.message})`);
    if (industriesResult.error) missing.push(`industries (${industriesResult.error.message})`);
    if (navResult.error) missing.push(`navigation (${navResult.error.message})`);
    setSkipped(missing);

    // The header and footer render `PRIMARY_NAV`/`FOOTER_NAV` from static config; the
    // `nav_items` table is also merged in because it exists and may be populated. Using only
    // one of the two would produce phantom orphan pages.
    const renderedNav = [
      ...PRIMARY_NAV.map((item) => item.href),
      ...FOOTER_NAV.flatMap((column) => column.items.map((item) => item.href)),
    ];
    const dbNav = ((navResult.data ?? []) as Array<{ href: string }>).map((item) => item.href);
    const navPaths = [...new Set([...renderedNav, ...dbNav])].filter((href) => href.startsWith("/"));

    try {
      setReport(
        runDiagnostics({
          pages: (pagesResult.data ?? []) as SeoRecord[],
          posts: (postsResult.data ?? []) as SeoRecord[],
          redirects: (redirectsResult.data ?? []) as RedirectRecord[],
          industries: (industriesResult.data ?? []) as Array<{ slug: string }>,
          navPaths,
        }),
      );
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error));
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(() => {
    if (!report) return [];
    const needle = query.trim().toLowerCase();
    return report.findings.filter((finding) => {
      if (severity !== "all" && finding.severity !== severity) return false;
      if (code !== "all" && finding.code !== code) return false;
      if (!needle) return true;
      return [finding.subject, finding.message, finding.path ?? "", codeLabel(finding.code)]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [report, severity, code, query]);

  const summary = report?.summary;
  const codeOptions = useMemo(
    () => (report ? report.summary.byCode.map((entry) => entry.code) : []),
    [report],
  );

  const copyAuditSummary = async () => {
    if (!report) return;
    const lines = report.findings
      .slice(0, 100)
      .map((finding) => `[${SEVERITY_LABEL[finding.severity]}] ${codeLabel(finding.code)} — ${finding.path ?? ""} — ${finding.message}`);
    const text = [
      `SEO diagnostics — ${new Date().toISOString()}`,
      `Scanned: ${report.summary.scanned.pages} pages, ${report.summary.scanned.posts} posts, ${report.summary.scanned.redirects} redirects`,
      `${report.summary.errors} errors, ${report.summary.warnings} warnings, ${report.summary.notices} notices`,
      "",
      ...lines,
    ].join("\n");
    try {
      await navigator.clipboard.writeText(text);
      push({ tone: "success", title: "Summary copied", description: "Plain text, ready to paste into an issue." });
    } catch {
      push({ tone: "warn", title: "Clipboard unavailable", description: "Your browser blocked access to the clipboard." });
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="max-w-2xl">
          <h1 className="flex items-center gap-1.5 text-xl font-semibold tracking-tight">
            <ScanSearch className="size-4 text-accent" aria-hidden="true" /> SEO diagnostics
          </h1>
          <p className="mt-1 text-[13px] leading-relaxed text-fg-muted">
            Conditions found in your own content: unreachable pages, thin descriptions, redirect loops, broken
            internal links. Every count below is the length of a list you can read.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => void copyAuditSummary()} disabled={!report}>
            Copy summary
          </Button>
          <Button variant="secondary" size="sm" onClick={() => void load()} loading={loading}>
            <RefreshCw className="size-3.5" /> Re-run
          </Button>
        </div>
      </div>

      <Callout tone="info" title="No score, by design">
        There is no “SEO score” on this screen. A number out of 100 would imply a ranking model this app does not
        have and cannot verify. What it has is rules — each finding names the row, the condition and the fix.
      </Callout>

      {!configured ? (
        <Callout tone="warn" title="No content source configured">
          Set <code>NEXT_PUBLIC_SUPABASE_URL</code> and <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code>, run the
          migrations and rebuild. Nothing is scanned until then — an empty report would look like a clean bill of
          health.
        </Callout>
      ) : null}

      {!PUBLIC_ENV.appUrl ? (
        <Callout tone="warn" title="This build has no canonical host">
          <code>NEXT_PUBLIC_APP_URL</code> is not set, so the exported build omits <code>sitemap.xml</code>,
          canonical links and Open Graph URLs. Content checks below still work; the pages will not.
        </Callout>
      ) : null}

      {loadError ? (
        <Callout tone="danger" title="Diagnostics could not run">
          {loadError}
        </Callout>
      ) : null}

      {skipped.length > 0 ? (
        <Callout tone="danger" title="Some data could not be read">
          These rules did not run, so their findings are missing rather than absent: {skipped.join("; ")}.
        </Callout>
      ) : null}

      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-24" />
          ))}
        </div>
      ) : summary ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile
              label="Errors"
              value={String(summary.errors)}
              hint={summary.itemsWithErrors > 0 ? `across ${summary.itemsWithErrors} item(s)` : "nothing broken"}
              tone={summary.errors > 0 ? "danger" : undefined}
            />
            <StatTile label="Warnings" value={String(summary.warnings)} hint="losing traffic or clarity" />
            <StatTile label="Notices" value={String(summary.notices)} hint="sometimes intentional" />
            <StatTile
              label="Scanned"
              value={`${summary.scanned.pages + summary.scanned.posts}`}
              hint={`${summary.scanned.pages} pages · ${summary.scanned.posts} posts · ${summary.scanned.redirects} redirects`}
            />
          </div>

          {summary.total === 0 ? (
            <EmptyState
              icon={<CheckCircle2 className="size-5 text-success" />}
              title="No findings from these rules"
              description={
                <>
                  That means the checks listed below found nothing in {summary.scanned.pages} page(s) and{" "}
                  {summary.scanned.posts} post(s) — not that the site ranks well. Search performance depends on
                  things this screen cannot see.
                </>
              }
            />
          ) : (
            <>
              <Card className="p-3">
                <div className="flex flex-wrap items-end gap-2">
                  <div className="flex items-center gap-1.5 text-[12px] text-fg-muted">
                    <Filter className="size-3.5" aria-hidden="true" /> Filter
                  </div>
                  <div className="flex items-center gap-1">
                    {(["all", "error", "warning", "notice"] as const).map((option) => (
                      <Button
                        key={option}
                        size="sm"
                        variant={severity === option ? "secondary" : "ghost"}
                        onClick={() => setSeverity(option)}
                      >
                        {option === "all" ? "All" : SEVERITY_LABEL[option]}
                        {option !== "all" ? (
                          <span className="ml-1 text-fg-subtle">
                            {option === "error" ? summary.errors : option === "warning" ? summary.warnings : summary.notices}
                          </span>
                        ) : null}
                      </Button>
                    ))}
                  </div>
                  <Select
                    aria-label="Filter by rule"
                    value={code}
                    onChange={(event) => setCode(event.target.value)}
                    className="w-56"
                  >
                    <option value="all">Every rule</option>
                    {codeOptions.map((option) => (
                      <option key={option} value={option}>
                        {codeLabel(option)}
                      </option>
                    ))}
                  </Select>
                  <Input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Filter by page or message"
                    aria-label="Filter findings"
                    className="w-64"
                  />
                  <span className="ml-auto text-[12px] text-fg-subtle">
                    Showing {visible.length} of {summary.total}
                  </span>
                </div>
              </Card>

              {visible.length === 0 ? (
                <EmptyState title="No findings match this filter" description="Clear the filters to see everything." />
              ) : (
                <ul className="space-y-2">
                  {visible.map((finding) => (
                    <Card as="li" key={finding.id} className="p-3.5">
                      <div className="flex flex-wrap items-start gap-2">
                        <span className="mt-0.5 shrink-0">{SEVERITY_ICON[finding.severity]}</span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-[13px] font-semibold">{codeLabel(finding.code)}</span>
                            <Badge tone={SEVERITY_TONE[finding.severity]}>{SEVERITY_LABEL[finding.severity]}</Badge>
                            <span className="truncate text-[12px] text-fg-subtle">{finding.subject}</span>
                          </div>
                          <p className="mt-1 text-[13px] text-fg-muted">{finding.message}</p>
                          <p className="mt-1 text-[12px] text-fg-subtle">
                            <span className="font-medium text-fg-muted">Fix:</span> {finding.fix}
                          </p>
                          <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px]">
                            {finding.path ? (
                              <a
                                href={finding.path}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-0.5 text-accent hover:underline"
                              >
                                {finding.path} <ArrowUpRight className="size-3" aria-hidden="true" />
                              </a>
                            ) : null}
                            {finding.editHref ? (
                              <a href={finding.editHref} className="text-fg-muted hover:underline">
                                Edit in {finding.editHref.split("/")[2]}
                              </a>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    </Card>
                  ))}
                </ul>
              )}
            </>
          )}
        </>
      ) : null}

      <Card className="p-4">
        <h2 className="text-sm font-semibold">What is checked</h2>
        <p className="mt-1 text-[13px] text-fg-muted">
          {SEVERITY_MEANING.error} {SEVERITY_MEANING.warning} {SEVERITY_MEANING.notice}
        </p>
        <ul className="mt-3 grid gap-1.5 text-[12px] text-fg-muted sm:grid-cols-2">
          {[
            "Published with no publish date (invisible everywhere)",
            "Scheduled content, which a static export never picks up on its own",
            "Missing or duplicated titles and meta descriptions",
            "Title and description lengths where results get truncated",
            "Thin bodies, measured as text with markup removed",
            "Cover images with no alt text",
            "CMS slugs that collide with real application routes",
            "Canonical URLs that point at themselves or are relative",
            "Redirect loops, chains, dead targets, and sources that shadow live pages",
            "Internal links pointing at nothing",
            "Published pages that nothing links to",
          ].map((item) => (
            <li key={item} className="flex gap-1.5">
              <span className="text-fg-subtle">·</span>
              {item}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[12px] text-fg-subtle">
          Not checked, because it would require crawling the web: backlinks, competitor comparison, ranking
          position, Core Web Vitals from real users, or whether anyone actually clicks.
        </p>
      </Card>
    </div>
  );
}
