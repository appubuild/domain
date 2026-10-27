/**
 * Media library rules.
 *
 * Two things must hold for the upload path to be safe and usable: only image formats the
 * browser can render are accepted (and never SVG, which is a script container), and every
 * stored object gets a generated path rather than a user-supplied one. The rest pins alt-text
 * quality, because "required" that accepts the word "image" is not a requirement.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  ACCEPTED_TYPES,
  ACCEPT_ATTRIBUTE,
  MAX_ALT_TEXT_LENGTH,
  MAX_UPLOAD_BYTES,
  MEDIA_BUCKET,
  acceptedType,
  acceptedTypeSentence,
  buildStoragePath,
  describeRow,
  dimensionsLabel,
  formatBytes,
  isValidStoragePath,
  altTextForPick,
  mediaUsage,
  publicUrlFor,
  sanitiseStem,
  typeLabel,
  validateAltText,
  validateUpload,
} from "@/lib/media/library";

const fixedDate = new Date("2026-03-04T10:00:00Z");
const fixedRandom = () => 0.5; // 0.5 * 16 = 8 → token "888888"

describe("accepted formats", () => {
  it("allows photographs and screenshots only", () => {
    expect(ACCEPTED_TYPES.map((type) => type.mime)).toEqual([
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/avif",
    ]);
  });

  it("never allows SVG", () => {
    expect(ACCEPTED_TYPES.some((type) => type.mime.includes("svg"))).toBe(false);
    expect(ACCEPT_ATTRIBUTE).not.toContain("svg");
  });

  it("normalises case and whitespace when matching", () => {
    expect(acceptedType(" Image/PNG ")?.ext).toBe("png");
    expect(acceptedType("image/gif")).toBeNull();
    expect(typeLabel("application/pdf")).toBe("application/pdf");
  });

  it("reads naturally in an error message", () => {
    expect(acceptedTypeSentence()).toBe("JPEG, PNG, WebP or AVIF");
  });
});

describe("formatBytes", () => {
  it.each([
    [512, "512 B"],
    [2048, "2.0 KB"],
    [40960, "40 KB"],
    [1536 * 1024, "1.5 MB"],
    [12 * 1024 * 1024, "12 MB"],
  ] as const)("renders %i as %s", (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(expected);
  });

  it("does not pretend to know a nonsense size", () => {
    expect(formatBytes(Number.NaN)).toBe("unknown size");
    expect(formatBytes(-1)).toBe("unknown size");
  });
});

describe("validateUpload", () => {
  const good = { name: "hero-shot.jpg", type: "image/jpeg", size: 800 * 1024 };
  const alt = "A laptop on a desk showing the DomainFits generator";

  it("accepts a normal image with real alt text", () => {
    expect(validateUpload(good, alt)).toEqual([]);
  });

  it("refuses SVG with a specific reason rather than a generic one", () => {
    const issues = validateUpload({ ...good, name: "logo.svg", type: "image/svg+xml" }, alt);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toMatch(/scripts/i);
  });

  it("refuses other non-image types", () => {
    const issues = validateUpload({ ...good, type: "application/zip" }, alt);
    expect(issues[0]?.message).toMatch(/Unsupported file type/);
  });

  it("refuses files over the limit and says both sizes", () => {
    const issues = validateUpload({ ...good, size: MAX_UPLOAD_BYTES + 1 }, alt);
    expect(issues[0]?.message).toContain("5.0 MB");
    expect(issues[0]?.message).toContain("5,242,880 bytes");
  });

  it("accepts exactly the limit", () => {
    expect(validateUpload({ ...good, size: MAX_UPLOAD_BYTES }, alt)).toEqual([]);
  });

  it("refuses an empty file", () => {
    expect(validateUpload({ ...good, size: 0 }, alt)[0]?.message).toMatch(/empty/i);
  });

  it("requires alt text before anything is uploaded", () => {
    const issues = validateUpload(good, "   ");
    expect(issues).toHaveLength(1);
    expect(issues[0]?.field).toBe("alt");
  });

  it("reports every problem at once", () => {
    const issues = validateUpload({ name: "x.svg", type: "image/svg+xml", size: 0 }, "");
    expect(issues.map((issue) => issue.field).sort()).toEqual(["alt", "file", "file"]);
  });
});

describe("validateAltText", () => {
  const describe_ = "Bar chart showing domain registrations rising each year";

  it("accepts a real description", () => {
    expect(validateAltText(describe_)).toBeNull();
  });

  it("rejects empty and too-short text", () => {
    expect(validateAltText("")?.code).toBe("empty");
    expect(validateAltText("a logo")?.code).toBe("too-short");
  });

  it("rejects over-long text", () => {
    expect(validateAltText("x".repeat(MAX_ALT_TEXT_LENGTH + 1))?.code).toBe("too-long");
    expect(validateAltText("x".repeat(MAX_ALT_TEXT_LENGTH))).toBeNull();
  });

  it.each(["image", "Photo", "screenshot.", "ALT TEXT", "n/a"])(
    "rejects the placeholder %s",
    (value) => {
      expect(validateAltText(value)?.code).toBe("placeholder");
    },
  );

  it("rejects the file name echoed back", () => {
    expect(validateAltText("hero-shot-2026", "hero-shot-2026.jpg")?.code).toBe("filename");
    expect(validateAltText("hero shot 2026", "hero-shot-2026.jpg")?.code).toBe("filename");
  });

  it("counts characters after trimming", () => {
    expect(validateAltText("   a logo   ")?.code).toBe("too-short");
  });
});

describe("storage paths", () => {
  it("builds a month-partitioned, slugged path", () => {
    expect(buildStoragePath("Hero Shot (final).JPG", "image/jpeg", fixedDate, fixedRandom)).toBe(
      "2026/03/hero-shot-final-888888.jpg",
    );
  });

  it("keeps the extension from the MIME type, not the name", () => {
    expect(buildStoragePath("photo.png", "image/webp", fixedDate, fixedRandom)).toMatch(/\.webp$/);
  });

  it("refuses to build a path for an unsupported type", () => {
    expect(() => buildStoragePath("x.svg", "image/svg+xml", fixedDate, fixedRandom)).toThrow(/Unsupported/);
  });

  it("strips traversal, dots and control characters from the stem", () => {
    const built = buildStoragePath("../../etc/passwd\u0000.jpg", "image/png", fixedDate, fixedRandom);
    expect(built).toBe("2026/03/etc-passwd-888888.png");
    expect(built).not.toContain("..");
    expect(isValidStoragePath(built)).toBe(true);
  });

  it("falls back to 'image' when nothing usable is left", () => {
    expect(sanitiseStem("日本語.jpg")).toBe("image");
    expect(sanitiseStem(".jpg")).toBe("image");
  });

  it("folds accents instead of dropping the letters", () => {
    expect(sanitiseStem("Café Crème.jpg")).toBe("cafe-creme");
  });

  it("caps the stem at 60 characters", () => {
    expect(sanitiseStem(`${"a".repeat(120)}.png`)).toHaveLength(60);
  });

  it("produces a different path for the same name at a different moment", () => {
    const first = buildStoragePath("a.png", "image/png", new Date("2026-03-04T10:00:00Z"), () => 0.1);
    const second = buildStoragePath("a.png", "image/png", new Date("2026-04-04T10:00:00Z"), () => 0.2);
    expect(first).not.toBe(second);
  });
});

describe("publicUrlFor", () => {
  it("builds the public object URL", () => {
    expect(publicUrlFor("https://abc.supabase.co", "2026/03/hero-1a2b3c.jpg")).toBe(
      "https://abc.supabase.co/storage/v1/object/public/media/2026/03/hero-1a2b3c.jpg",
    );
  });

  it("tolerates a trailing slash on the base URL", () => {
    expect(publicUrlFor("https://abc.supabase.co/", "2026/03/a.png")).toContain("/storage/v1/object/public/media/2026/03/a.png");
  });

  it("returns null rather than a broken URL when unconfigured", () => {
    expect(publicUrlFor(null, "2026/03/a.png")).toBeNull();
    expect(publicUrlFor("", "2026/03/a.png")).toBeNull();
  });

  it("encodes each path segment", () => {
    expect(publicUrlFor("https://abc.supabase.co", "2026/03/a b.png")).toContain("2026/03/a%20b.png");
  });
});

describe("rows", () => {
  const row = {
    id: "1",
    storage_path: "2026/03/hero.png",
    file_name: "hero.png",
    mime_type: "image/png",
    byte_size: 240 * 1024,
    width: 1600,
    height: 900,
    alt_text: "A laptop on a desk showing the generator",
    caption: "",
    created_at: "2026-03-04T10:00:00Z",
  };

  it("flags rows whose alt text would fail validation", () => {
    expect(mediaUsage(row)).toBe("complete");
    expect(mediaUsage({ ...row, alt_text: "" })).toBe("missing-alt");
    expect(mediaUsage({ ...row, alt_text: "image" })).toBe("missing-alt");
  });

  it("admits when dimensions are unknown", () => {
    expect(dimensionsLabel(1600, 900)).toBe("1600 × 900");
    expect(dimensionsLabel(null, null)).toBe("dimensions not recorded");
    expect(dimensionsLabel(800, null)).toBe("dimensions not recorded");
  });

  it("summarises a row for the grid", () => {
    expect(describeRow(row)).toBe("PNG · 240 KB · 1600 × 900");
  });
});

describe("picking an image for a content field", () => {
  const described = { alt_text: "A laptop on a desk showing the generator" };
  const blank = { alt_text: "   " };

  it("fills an empty alt field with the image's description", () => {
    expect(altTextForPick(described, "")).toBe("A laptop on a desk showing the generator");
    expect(altTextForPick(described, "   ")).toBe("A laptop on a desk showing the generator");
    expect(altTextForPick(described, null)).toBe("A laptop on a desk showing the generator");
  });

  it("never overwrites words an author already wrote", () => {
    expect(altTextForPick(described, "Our editor's own description")).toBeNull();
  });

  it("leaves the field alone when the image has no description", () => {
    // Returning "" here would blank a correct description that was already in the form.
    expect(altTextForPick(blank, "")).toBeNull();
    expect(altTextForPick({ alt_text: "" }, "kept")).toBeNull();
  });
});

describe("storage migration", () => {
  const sql = readFileSync(
    path.join(process.cwd(), "supabase", "migrations", "0007_media_storage.sql"),
    "utf8",
  );

  it("creates the bucket the library uploads to", () => {
    expect(MEDIA_BUCKET).toBe("media");
    expect(sql).toContain("values ('media', 'media', true)");
  });

  it("restricts writes to administrators", () => {
    for (const operation of ["insert", "update", "delete"]) {
      const policy = new RegExp(
        `create policy media_bucket_admin_${operation}[\\s\\S]*?public\\.is_admin\\(\\)`,
        "i",
      );
      expect(sql, `missing admin-only ${operation} policy`).toMatch(policy);
    }
  });

  it("keeps the MIME constraint in step with the client allowlist", () => {
    const constraint = sql.match(/mime_type in \(([^)]+)\)/)?.[1] ?? "";
    for (const type of ACCEPTED_TYPES) {
      expect(constraint).toContain(`'${type.mime}'`);
    }
    expect(constraint).not.toContain("svg");
  });

  it("enforces the same path shape the client generates", () => {
    expect(sql).toContain("media_storage_path_shape");
    const sample = buildStoragePath("hero shot.jpg", "image/jpeg", fixedDate, fixedRandom);
    expect(isValidStoragePath(sample)).toBe(true);
  });
});
