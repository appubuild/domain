import { describe, expect, it } from "vitest";
import {
  CSV_COLUMNS,
  exportFilename,
  quoteCsvField,
  sanitizeForSpreadsheet,
  serializeExport,
  toCsv,
  toJson,
  toTxt,
  type ExportCandidate,
} from "@/lib/export/exporters";
import { createGenerationRequest, generate } from "@/lib/brain";

function candidate(label: string, overrides: Partial<ExportCandidate> = {}): ExportCandidate {
  return {
    label,
    displayName: label,
    root: "pay",
    length: label.length,
    syllables: 2,
    strategy: "partner-combination",
    overall: 70,
    quality: { score: 72.5, factors: [], profileId: "quality-default", profileVersion: 1 },
    brandability: { score: 64, factors: [], profileId: "brandable-default", profileVersion: 1 },
    domains: [
      { tld: "com", domain: `${label}.com` },
      { tld: "io", domain: `${label}.io` },
    ],
    ...overrides,
  };
}

describe("CSV export", () => {
  it("emits a header row and CRLF endings", () => {
    const csv = toCsv([candidate("paynest")]);
    expect(csv.startsWith(CSV_COLUMNS.join(","))).toBe(true);
    expect(csv).toContain("\r\n");
    expect(csv.endsWith("\r\n")).toBe(true);
    expect(csv.split("\r\n").filter(Boolean)).toHaveLength(2);
  });

  it("quotes fields containing commas, quotes and newlines", () => {
    expect(quoteCsvField('a,b')).toBe('"a,b"');
    expect(quoteCsvField('say "hi"')).toBe('"say ""hi"""');
    expect(quoteCsvField("line\nbreak")).toBe('"line\nbreak"');
    expect(quoteCsvField("plain")).toBe("plain");
  });

  it("neutralises spreadsheet formula injection", () => {
    expect(sanitizeForSpreadsheet("=1+1")).toBe("'=1+1");
    expect(sanitizeForSpreadsheet("+pay")).toBe("'+pay");
    expect(sanitizeForSpreadsheet("-pay")).toBe("'-pay");
    expect(sanitizeForSpreadsheet("@pay")).toBe("'@pay");
    expect(quoteCsvField("=HYPERLINK()")).toBe("'=HYPERLINK()");
    expect(toCsv([candidate("=evil")])).toContain("'=evil.com");
  });

  it("writes unchecked availability honestly", () => {
    const csv = toCsv([candidate("paynest")]);
    expect(csv).toContain("unchecked");
  });

  it("includes checked availability when present", () => {
    const csv = toCsv([
      candidate("paynest", {
        availability: { status: "available_verified", checkedAt: "2026-01-01T00:00:00.000Z", provider: "rdap" },
      }),
    ]);
    expect(csv).toContain("available_verified");
    expect(csv).toContain("2026-01-01T00:00:00.000Z");
  });
});

describe("TXT export", () => {
  it("writes one domain per line with a trailing newline", () => {
    const txt = toTxt([candidate("paynest"), candidate("payhub")]);
    expect(txt).toBe("paynest.com\npayhub.com\n");
  });

  it("can target a specific TLD", () => {
    expect(toTxt([candidate("paynest")], "io")).toBe("paynest.io\n");
  });

  it("returns an empty string when there is nothing to export", () => {
    expect(toTxt([])).toBe("");
  });
});

describe("JSON export", () => {
  it("parses back to the documented shape", () => {
    const json = JSON.parse(toJson([candidate("paynest")], { format: "json", generatedAt: "2026-01-01T00:00:00.000Z" }));
    expect(json.count).toBe(1);
    expect(json.exportedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(json.candidates[0].label).toBe("paynest");
    expect(json.candidates[0].domains).toEqual(["paynest.com", "paynest.io"]);
    expect(json.candidates[0].scores.quality.score).toBe(72.5);
    expect(json.candidates[0].availability.status).toBe("unchecked");
  });

  it("includes factor breakdowns only when requested", () => {
    const withFactors = JSON.parse(toJson([candidate("paynest")], { format: "json", includeFactors: true }));
    expect(withFactors.candidates[0].scores.quality.factors).toEqual([]);
  });
});

describe("serializeExport", () => {
  it("returns correct mime type and extension", () => {
    expect(serializeExport([candidate("a1")], { format: "csv" })).toMatchObject({ mimeType: "text/csv;charset=utf-8", extension: "csv" });
    expect(serializeExport([candidate("a1")], { format: "txt" })).toMatchObject({ extension: "txt" });
    expect(serializeExport([candidate("a1")], { format: "json" })).toMatchObject({ extension: "json" });
  });

  it("produces a filename with the format extension", () => {
    expect(exportFilename("csv", new Date("2026-03-04T05:06:07Z"))).toBe("domainfits-2026-03-04T05-06-07.csv");
  });
});

describe("end-to-end export from the engine", () => {
  it("exports real generated candidates with consistent counts", () => {
    const result = generate(
      createGenerationRequest({ roots: ["pay"], targetCount: 20, tlds: ["com"], seed: 5 }),
    );
    const csv = toCsv(result.candidates);
    const rows = csv.split("\r\n").filter(Boolean);
    expect(rows).toHaveLength(result.candidates.length + 1);
    const json = JSON.parse(toJson(result.candidates, { format: "json" }));
    expect(json.count).toBe(result.candidates.length);
    expect(json.candidates.every((c: { domains: string[] }) => c.domains.length === 1)).toBe(true);
  });
});
