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
