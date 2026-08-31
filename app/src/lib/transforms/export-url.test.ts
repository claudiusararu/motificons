import { describe, expect, it } from "vitest";
import { buildExportUrl } from "./export-url";

describe("buildExportUrl", () => {
  it("always includes format, and size when given", () => {
    const url = buildExportUrl("lucide", "star", "svg", {}, 24);
    expect(url).toBe("/api/export/lucide/star?format=svg&size=24");
  });

  it("omits size entirely when not given - never sends the literal string 'undefined'", () => {
    const url = buildExportUrl("lucide", "star", "svg", {});
    const params = new URL(url, "http://x").searchParams;
    expect(params.has("size")).toBe(false);
    expect(url).not.toContain("undefined");
  });

  it("adds color only when set", () => {
    const url = buildExportUrl("lucide", "star", "png", { color: "#ff0000" }, 512);
    const params = new URL(url, "http://x").searchParams;
    expect(params.get("color")).toBe("#ff0000");
  });

  it("adds stroke only when set", () => {
    const url = buildExportUrl("lucide", "star", "svg", { strokeWidth: 1.5 }, 24);
    const params = new URL(url, "http://x").searchParams;
    expect(params.get("stroke")).toBe("1.5");
  });

  it("omits stroke/color when unset, so the server keeps the icon's own look", () => {
    const url = buildExportUrl("lucide", "star", "svg", {}, 24);
    const params = new URL(url, "http://x").searchParams;
    expect(params.has("color")).toBe(false);
    expect(params.has("stroke")).toBe(false);
  });

  it("adds boolean/transform flags only when truthy", () => {
    const url = buildExportUrl(
      "lucide",
      "star",
      "svg",
      { cssStyleable: true, rotate: 90, flipH: true, flipV: false, padding: 0.1 },
      24,
    );
    const params = new URL(url, "http://x").searchParams;
    expect(params.get("css")).toBe("1");
    expect(params.get("rotate")).toBe("90");
    expect(params.get("flipH")).toBe("1");
    expect(params.has("flipV")).toBe(false);
    expect(params.get("padding")).toBe("0.1");
  });
});
