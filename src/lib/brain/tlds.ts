/**
 * TLD directory seed.
 *
 * `checkability` records whether we can actually verify availability for an extension —
 * it is never inferred from the fact that the extension exists. The production directory
 * lives in the `tlds` table and is edited from the admin panel; this file is the offline
 * default and the seed source.
 */

export type TldCheckability = "rdap" | "registrar-api" | "unknown" | "unsupported";

export type TldRecord = {
  tld: string;
  displayName: string;
  description: string;
  enabled: boolean;
  /** Category used for grouping in the UI. */
  category: "generic" | "technology" | "business" | "country" | "media" | "social";
  /** Whether availability checking is possible, and through which provider family. */
  checkability: TldCheckability;
  /** Notes shown in the extension directory (honest about limits). */
  note?: string;
  displayOrder: number;
};

export const TLD_DIRECTORY: TldRecord[] = [
  { tld: "com", displayName: ".com", description: "The default global extension and the most recognised.", enabled: true, category: "generic", checkability: "rdap", displayOrder: 1 },
  { tld: "io", displayName: ".io", description: "Popular with developer tools and startups.", enabled: true, category: "technology", checkability: "rdap", displayOrder: 2 },
  { tld: "ai", displayName: ".ai", description: "Anguilla ccTLD widely used by AI products.", enabled: true, category: "technology", checkability: "rdap", note: "Registry responses vary; always confirm at a registrar before purchase.", displayOrder: 3 },
  { tld: "co", displayName: ".co", description: "Colombia ccTLD used as a short alternative to .com.", enabled: true, category: "business", checkability: "rdap", displayOrder: 4 },
  { tld: "app", displayName: ".app", description: "Google-operated extension with enforced HTTPS.", enabled: true, category: "technology", checkability: "rdap", displayOrder: 5 },
  { tld: "dev", displayName: ".dev", description: "Google-operated extension with enforced HTTPS.", enabled: true, category: "technology", checkability: "rdap", displayOrder: 6 },
  { tld: "net", displayName: ".net", description: "Long-standing network-oriented global extension.", enabled: true, category: "generic", checkability: "rdap", displayOrder: 7 },
  { tld: "org", displayName: ".org", description: "Global extension traditionally used by organisations.", enabled: true, category: "generic", checkability: "rdap", displayOrder: 8 },
  { tld: "xyz", displayName: ".xyz", description: "Low-cost generic extension.", enabled: false, category: "generic", checkability: "rdap", displayOrder: 9 },
  { tld: "sh", displayName: ".sh", description: "St Helena ccTLD used by developer and shell projects.", enabled: false, category: "technology", checkability: "unknown", note: "RDAP coverage is inconsistent.", displayOrder: 10 },
  { tld: "studio", displayName: ".studio", description: "Creative and agency extension.", enabled: false, category: "media", checkability: "rdap", displayOrder: 11 },
  { tld: "tech", displayName: ".tech", description: "Technology-focused generic extension.", enabled: false, category: "technology", checkability: "rdap", displayOrder: 12 },
];

export const DEFAULT_TLDS = TLD_DIRECTORY.filter((record) => record.enabled).map((record) => record.tld);

export function tldRecord(tld: string): TldRecord | undefined {
  return TLD_DIRECTORY.find((record) => record.tld === tld.toLowerCase());
}

export function checkabilityLabel(value: TldCheckability): string {
  switch (value) {
    case "rdap":
      return "Verifiable via RDAP";
    case "registrar-api":
      return "Verifiable via registrar API";
    case "unsupported":
      return "Not checkable";
    default:
      return "Unverified";
  }
}
