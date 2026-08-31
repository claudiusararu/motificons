import { describe, expect, it } from "vitest";
import {
  isValidHexColor,
  validateAnchorIconId,
  validateColor,
  validateExportFormat,
  validateSize,
  validateStrokeWidth,
} from "./collection-style";

/* computeStyleTargets moved to ../style-targets.ts (shared client+server
   module, so the styles panel can compute a live readout the moment a
   visitor picks an anchor, not just after a save round-trip) - its tests
   moved with it, to ../style-targets.test.ts. */

describe("validateAnchorIconId", () => {
  it("accepts null/undefined/empty as a clear", () => {
    expect(validateAnchorIconId(null)).toEqual({ ok: true, value: null });
    expect(validateAnchorIconId(undefined)).toEqual({ ok: true, value: null });
    expect(validateAnchorIconId("")).toEqual({ ok: true, value: null });
  });

  it("accepts a well-formed icon id", () => {
    expect(validateAnchorIconId("akar-icons:air")).toEqual({
      ok: true,
      value: "akar-icons:air",
    });
  });

  it("rejects a malformed id", () => {
    expect(validateAnchorIconId("akar-icons").ok).toBe(false);
    expect(validateAnchorIconId("akar-icons:air:extra").ok).toBe(false);
    expect(validateAnchorIconId("../../etc:passwd").ok).toBe(false);
  });

  it("rejects a non-string payload", () => {
    expect(validateAnchorIconId(42).ok).toBe(false);
  });
});

describe("isValidHexColor", () => {
  it("accepts 6-digit and 3-digit hex", () => {
    expect(isValidHexColor("#183153")).toBe(true);
    expect(isValidHexColor("#fff")).toBe(true);
  });

  it("rejects non-hex input", () => {
    expect(isValidHexColor("blue")).toBe(false);
    expect(isValidHexColor("183153")).toBe(false);
    expect(isValidHexColor("#12345")).toBe(false);
    expect(isValidHexColor("#gggggg")).toBe(false);
  });
});

describe("validateStrokeWidth", () => {
  it("accepts null/undefined/empty as a clear", () => {
    expect(validateStrokeWidth(null)).toEqual({ ok: true, value: null });
    expect(validateStrokeWidth(undefined)).toEqual({ ok: true, value: null });
    expect(validateStrokeWidth("")).toEqual({ ok: true, value: null });
  });

  it("accepts a positive number", () => {
    expect(validateStrokeWidth(1.5)).toEqual({ ok: true, value: 1.5 });
  });

  it("rejects zero, negative, and out-of-range values", () => {
    expect(validateStrokeWidth(0).ok).toBe(false);
    expect(validateStrokeWidth(-2).ok).toBe(false);
    expect(validateStrokeWidth(100).ok).toBe(false);
  });

  it("rejects non-numeric strings", () => {
    expect(validateStrokeWidth("thick").ok).toBe(false);
  });
});

describe("validateColor", () => {
  it("accepts null/empty as a clear", () => {
    expect(validateColor(null)).toEqual({ ok: true, value: null });
    expect(validateColor("")).toEqual({ ok: true, value: null });
  });

  it("accepts and lowercases a hex value", () => {
    expect(validateColor("#183153")).toEqual({ ok: true, value: "#183153" });
    expect(validateColor("#ABCDEF")).toEqual({ ok: true, value: "#abcdef" });
  });

  it("rejects a non-hex string", () => {
    expect(validateColor("papayawhip").ok).toBe(false);
  });
});

describe("validateSize", () => {
  it("accepts null/empty as a clear", () => {
    expect(validateSize(null)).toEqual({ ok: true, value: null });
  });

  it("accepts a positive integer", () => {
    expect(validateSize(128)).toEqual({ ok: true, value: 128 });
  });

  it("rejects a non-integer, zero, or out-of-range value", () => {
    expect(validateSize(12.5).ok).toBe(false);
    expect(validateSize(0).ok).toBe(false);
    expect(validateSize(10000).ok).toBe(false);
  });
});

describe("validateExportFormat", () => {
  it("accepts a known format", () => {
    expect(validateExportFormat("svg")).toEqual({ ok: true, value: "svg" });
    expect(validateExportFormat("swiftui")).toEqual({ ok: true, value: "swiftui" });
  });

  it("rejects an unknown format", () => {
    expect(validateExportFormat("bmp").ok).toBe(false);
    expect(validateExportFormat(undefined).ok).toBe(false);
  });
});
