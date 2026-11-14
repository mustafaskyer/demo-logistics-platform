import { describe, expect, test } from "bun:test";
import { constraintViolation, definedOnly } from "@app/platform/tenant.js";
import {
  licenseExpiresOnSchema,
  licenseNumberSchema,
  licenseValidOn,
  phoneSchema,
} from "@app/services/drivers/schemas.js";
import { objectKeyFor, safeFilename } from "@app/services/documents/schemas.js";
import { normalizePlate, plateSchema, vinSchema, yearSchema } from "@app/services/fleet/schemas.js";

describe("fleet schemas", () => {
  test("plates are trimmed, bounded and normalised to upper case with single spaces", () => {
    expect(plateSchema.parse("  abc   123 ")).toBe("abc   123");
    expect(normalizePlate("abc   123")).toBe("ABC 123");
    expect(plateSchema.safeParse("a").success).toBe(false);
    expect(plateSchema.safeParse("x".repeat(17)).success).toBe(false);
  });

  test("VINs are 17 characters without I, O or Q, and are upper-cased", () => {
    expect(vinSchema.parse("1hgcm82633a004352")).toBe("1HGCM82633A004352");
    for (const bad of ["", "1HGCM82633A00435", "1HGCM82633A0043521", "1HGCM82633A00435I", "1HGCM82633A00435O", "1HGCM82633A00435Q"]) {
      expect(vinSchema.safeParse(bad).success).toBe(false);
    }
  });

  test("years stay within a plausible range", () => {
    const next = new Date().getFullYear() + 1;
    expect(yearSchema.safeParse(1980).success).toBe(true);
    expect(yearSchema.safeParse(next).success).toBe(true);
    expect(yearSchema.safeParse(1979).success).toBe(false);
    expect(yearSchema.safeParse(next + 1).success).toBe(false);
    expect(yearSchema.safeParse(2020.5).success).toBe(false);
  });
});

describe("driver schemas", () => {
  test("license expiry must be a real calendar date", () => {
    expect(licenseExpiresOnSchema.safeParse("2030-02-28").success).toBe(true);
    for (const bad of ["2030-02-30", "2030-13-01", "30-01-2030", "2030/01/01", "", "tomorrow"]) {
      expect(licenseExpiresOnSchema.safeParse(bad).success).toBe(false);
    }
  });

  test("a license is valid through its expiry day inclusive", () => {
    const today = new Date("2026-11-14T12:00:00Z");
    expect(licenseValidOn("2026-11-14", today)).toBe(true);
    expect(licenseValidOn("2026-11-15", today)).toBe(true);
    expect(licenseValidOn("2026-11-13", today)).toBe(false);
  });

  test("phone numbers and license numbers are validated and normalised", () => {
    expect(phoneSchema.safeParse("+20 100 123 4567").success).toBe(true);
    expect(phoneSchema.safeParse("(02) 1234-5678").success).toBe(true);
    expect(phoneSchema.safeParse("call me").success).toBe(false);
    expect(phoneSchema.safeParse("123").success).toBe(false);
    expect(licenseNumberSchema.parse(" eg-123 ")).toBe("EG-123");
    expect(licenseNumberSchema.safeParse("abc").success).toBe(false);
  });
});

describe("document keys", () => {
  test("filenames lose path separators, control characters and dot runs", () => {
    expect(safeFilename("../../etc/passwd")).toBe("etcpasswd");
    expect(safeFilename("licence front.pdf")).toBe("licence-front.pdf");
    expect(safeFilename("..hidden.pdf")).toBe("hidden.pdf");
    expect(safeFilename("a\u0000b\nc.pdf")).toBe("abc.pdf");
    expect(safeFilename("///")).toBe("file");
    expect(safeFilename("x".repeat(500)).length).toBe(80);
  });

  test("object keys are scoped to the company and owner", () => {
    const key = objectKeyFor("org-1", "driver", "drv-9", "doc-3", "../Licence Front.pdf");
    expect(key).toBe("org-1/driver/drv-9/doc-3-Licence-Front.pdf");
    expect(key.startsWith("org-1/")).toBe(true);
    expect(key).not.toContain("..");
  });
});

describe("tenant helpers", () => {
  test("definedOnly drops undefined entries but keeps null and falsy values", () => {
    expect(definedOnly({ a: 1, b: undefined, c: null, d: 0, e: "" })).toEqual({ a: 1, c: null, d: 0, e: "" });
  });

  test("constraintViolation recognises Postgres unique and foreign-key errors, even when wrapped", () => {
    expect(constraintViolation({ code: "23505", constraint: "vehicle_org_plate_idx" })).toEqual({
      kind: "unique",
      name: "vehicle_org_plate_idx",
    });
    expect(constraintViolation({ code: "23503", constraint: "fk" })).toEqual({ kind: "foreign-key", name: "fk" });
    expect(constraintViolation(new Error("wrapped", { cause: { errno: "23505", constraintName: "x_vin_idx" } }))).toEqual({
      kind: "unique",
      name: "x_vin_idx",
    });
    expect(constraintViolation(new Error("boom"))).toBeNull();
    expect(constraintViolation(null)).toBeNull();
    expect(constraintViolation({ code: "42P01" })).toBeNull();
  });
});
