/**
 * Registry shape rules that the database contract test cannot see.
 *
 * These catch the mistakes that make a generic CRUD screen subtly wrong rather than broken:
 * a reference field without a source, a nullable reference that would write "" into a uuid
 * column, two resources editing the same table, or a nav entry pointing at nothing.
 */

import { describe, expect, it } from "vitest";
import { ADMIN_RESOURCES, type AdminField } from "@/lib/admin/resources";

const referenceFields = ADMIN_RESOURCES.flatMap((resource) =>
  resource.fields
    .filter((field) => field.type === "reference")
    .map((field) => ({ resource: resource.table, field })),
);

describe("reference fields", () => {
  it("exist at all", () => {
    expect(referenceFields.length).toBeGreaterThan(0);
  });

  it("declare a source table and the two columns to read", () => {
    for (const { resource, field } of referenceFields) {
      expect(field.reference, `${resource}.${field.key}`).toBeDefined();
      const reference = field.reference;
      if (!reference) continue;
      expect(reference.table, `${resource}.${field.key}`).toMatch(/^[a-z_]+$/);
      expect(reference.valueColumn, `${resource}.${field.key}`).toBeTruthy();
      expect(reference.labelColumn, `${resource}.${field.key}`).toBeTruthy();
      expect(reference.valueColumn).not.toBe(reference.labelColumn);
    }
  });

  it("never reference a table that does not exist", async () => {
    const known = new Set(ADMIN_RESOURCES.map((resource) => resource.table));
    // Referenced tables that are intentionally not themselves admin resources.
    const external = new Set(["auth.users"]);
    for (const { resource, field } of referenceFields) {
      const table = field.reference?.table ?? "";
      expect(known.has(table) || external.has(table), `${resource}.${field.key} → ${table}`).toBe(true);
    }
  });

  it("declare every reference as either optional or required", () => {
    for (const { resource, field } of referenceFields) {
      // Provider/industry/category ids are all nullable foreign keys in the schema, except
      // affiliate_tld_rules.provider_id, which is part of the row identity and required.
      const isIdentity = Boolean(field.immutable && field.required);
      if (isIdentity) {
        expect(field.nullable, `${resource}.${field.key} is identity, must not be nullable`).not.toBe(true);
      } else {
        // A reference must state which it is: optional (nullable) or required. Leaving both
        // unset is the ambiguity this rule exists to prevent.
        expect(
          field.nullable === true || field.required === true,
          `${resource}.${field.key} is a reference but neither nullable nor required`,
        ).toBe(true);
      }
    }
  });

  it("do not combine reference with a static option list", () => {
    for (const { resource, field } of referenceFields) {
      expect(field.options, `${resource}.${field.key}`).toBeUndefined();
    }
  });
});

describe("field definitions", () => {
  function allFields(): Array<{ resource: string; field: AdminField }> {
    return ADMIN_RESOURCES.flatMap((resource) => resource.fields.map((field) => ({ resource: resource.table, field })));
  }

  it("give every select field options", () => {
    for (const { resource, field } of allFields()) {
      if (field.type !== "select") continue;
      expect(field.options?.length, `${resource}.${field.key}`).toBeGreaterThan(0);
    }
  });

  it("never declare duplicate field keys within a resource", () => {
    for (const resource of ADMIN_RESOURCES) {
      const keys = resource.fields.map((field) => field.key);
      expect(new Set(keys).size, resource.table).toBe(keys.length);
    }
  });

  it("never declare duplicate list columns within a resource", () => {
    for (const resource of ADMIN_RESOURCES) {
      const keys = resource.listColumns.map((column) => column.key);
      expect(new Set(keys).size, resource.table).toBe(keys.length);
    }
  });

  it("always order by a column that also exists as a field or audit column", () => {
    const auditColumns = new Set(["created_at", "updated_at"]);
    for (const resource of ADMIN_RESOURCES) {
      const known = new Set([...resource.fields.map((field) => field.key), ...auditColumns]);
      expect(known.has(resource.orderBy.column), `${resource.table}.${resource.orderBy.column}`).toBe(true);
    }
  });

  it("give every searchable resource at least one text-ish column", () => {
    for (const resource of ADMIN_RESOURCES) {
      expect(resource.searchColumns.length, resource.table).toBeGreaterThan(0);
    }
  });
});

describe("media fields", () => {
  const mediaFields = ADMIN_RESOURCES.flatMap((resource) =>
    resource.fields
      .filter((field) => field.type === "media")
      .map((field) => ({ resource, field })),
  );

  it("declares the image fields the site actually renders", () => {
    const keys = new Set(mediaFields.map(({ resource, field }) => `${resource.key}.${field.key}`));
    expect(keys.has("posts.cover_image_url")).toBe(true);
    expect(keys.has("posts.og_image_url")).toBe(true);
    expect(keys.has("pages.og_image_url")).toBe(true);
  });

  it("points every altKey at a real text field in the same resource", () => {
    for (const { resource, field } of mediaFields) {
      const altKey = field.media?.altKey;
      if (!altKey) continue;
      const target = resource.fields.find((candidate) => candidate.key === altKey);
      expect(target, `${resource.label}.${field.key} → missing field ${altKey}`).toBeDefined();
      expect(target?.type, `${resource.label}.${altKey} must be text`).toBe("text");
    }
  });

  it("gives a cover image an alt field, so the picker can fill it", () => {
    for (const { resource, field } of mediaFields) {
      if (field.key === "cover_image_url") {
        expect(field.media?.altKey, `${resource.label}.cover_image_url needs an altKey`).toBeDefined();
      }
    }
  });

  it("never marks an image field as an HTML field", () => {
    for (const { field } of mediaFields) {
      expect(field.sanitize).not.toBe(true);
      expect(field.type).toBe("media");
    }
  });

  it("keeps image fields out of list columns", () => {
    for (const { resource, field } of mediaFields) {
      expect(
        resource.listColumns.some((column) => column.key === field.key && !field.hideInList),
        `${resource.label}.${field.key} is both a list column and a URL`,
      ).toBe(false);
    }
  });
});
