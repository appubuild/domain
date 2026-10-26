/**
 * Export serialisers.
 *
 * Rules enforced here (Section 10.2):
 *  - TXT: one domain per line, trailing newline, UTF-8.
 *  - CSV: RFC 4180 quoting, CRLF line endings, and formula-injection neutralisation so a
 *    spreadsheet cannot execute a generated label as a formula.
 *  - JSON: stable, documented shape including score breakdowns, plus metadata.
 *
 * Everything is pure string building so it can be unit tested and streamed later.
 */

import type { Candidate } from "@/lib/brain/types";

export type ExportFormat = "txt" | "csv" | "json";

export type ExportCandidate = Pick<
  Candidate,
  | "label"
  | "displayName"
  | "root"
  | "length"
  | "syllables"
  | "strategy"
  | "overall"
  | "quality"
  | "brandability"
  | "domains"
> & {
  /** Optional availability info when a check has actually run. */
  availability?: {
    status: string;
    checkedAt: string | null;
    provider: string | null;
  };
};

export type ExportOptions = {
  format: ExportFormat;
  /** Which TLD column to export in TXT mode; defaults to the first. */
  tld?: string;
  /** Include the full score breakdown in JSON output. */
  includeFactors?: boolean;
  generatedAt?: string;
};

/** Neutralises spreadsheet formula injection without altering the readable value. */
export function sanitizeForSpreadsheet(value: string): string {
  if (/^[=+\-@\t\r]/.test(value)) return `'${value}`;
  return value;
}

export function quoteCsvField(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const text = sanitizeForSpreadsheet(String(value));
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export const CSV_COLUMNS = [
  "domain",
  "label",
  "root",
  "tld",
  "length",
  "syllables",
  "strategy",
  "quality_score",
  "brandability_score",
  "overall_score",
  "availability_status",
  "last_checked",
] as const;

export function toTxt(candidates: ExportCandidate[], tld?: string): string {
  if (candidates.length === 0) return "";
  const lines = candidates.map((candidate) => {
    if (tld) return `${candidate.label}.${tld}`;
    const primary = candidate.domains[0];
    return primary ? primary.domain : candidate.label;
  });
  return `${lines.join("\n")}\n`;
}

export function toCsv(candidates: ExportCandidate[]): string {
  const header = CSV_COLUMNS.join(",");
  const rows = candidates.map((candidate) => {
    const primary = candidate.domains[0];
    return [
      quoteCsvField(primary?.domain ?? candidate.label),
      quoteCsvField(candidate.label),
      quoteCsvField(candidate.root),
      quoteCsvField(primary?.tld ?? ""),
      quoteCsvField(candidate.length),
      quoteCsvField(candidate.syllables),
      quoteCsvField(candidate.strategy),
      quoteCsvField(candidate.quality.score.toFixed(1)),
      quoteCsvField(candidate.brandability.score.toFixed(1)),
      quoteCsvField(candidate.overall.toFixed(1)),
      quoteCsvField(candidate.availability?.status ?? "unchecked"),
      quoteCsvField(candidate.availability?.checkedAt ?? ""),
    ].join(",");
  });
  // RFC 4180 uses CRLF; Excel accepts it and it preserves line integrity.
  return `${[header, ...rows].join("\r\n")}\r\n`;
}

export function toJson(candidates: ExportCandidate[], options: ExportOptions = { format: "json" }): string {
  const payload = {
    exportedAt: options.generatedAt ?? new Date().toISOString(),
    count: candidates.length,
    note:
      "Scores are documented heuristics, not appraisals. Availability values are only present when a real check ran; 'unchecked' means no registry lookup was performed.",
    candidates: candidates.map((candidate) => ({
      label: candidate.label,
      displayName: candidate.displayName,
      root: candidate.root,
      length: candidate.length,
      syllables: candidate.syllables,
      strategy: candidate.strategy,
      scores: {
        overall: candidate.overall,
        quality: options.includeFactors
          ? candidate.quality
          : { score: candidate.quality.score, profileId: candidate.quality.profileId, profileVersion: candidate.quality.profileVersion },
        brandability: options.includeFactors
          ? candidate.brandability
          : {
              score: candidate.brandability.score,
              profileId: candidate.brandability.profileId,
              profileVersion: candidate.brandability.profileVersion,
            },
      },
      domains: candidate.domains.map((entry) => entry.domain),
      availability: candidate.availability ?? { status: "unchecked", checkedAt: null, provider: null },
    })),
  };
  return `${JSON.stringify(payload, null, 2)}\n`;
}

export function serializeExport(
  candidates: ExportCandidate[],
  options: ExportOptions,
): { content: string; mimeType: string; extension: string } {
  switch (options.format) {
    case "csv":
      return { content: toCsv(candidates), mimeType: "text/csv;charset=utf-8", extension: "csv" };
    case "json":
      return { content: toJson(candidates, options), mimeType: "application/json;charset=utf-8", extension: "json" };
    case "txt":
    default:
      return { content: toTxt(candidates, options.tld), mimeType: "text/plain;charset=utf-8", extension: "txt" };
  }
}

/** Filename-safe timestamp, deterministic enough for tests. */
export function exportFilename(format: ExportFormat, now = new Date()): string {
  const stamp = now.toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return `domainfits-${stamp}.${format}`;
}
