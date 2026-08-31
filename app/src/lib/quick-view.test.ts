import { describe, expect, it } from "vitest";
import { combineQuickViewEdits, isPlainLeftClick } from "./quick-view";

function clickEvent(overrides: Partial<Parameters<typeof isPlainLeftClick>[0]> = {}) {
  return {
    defaultPrevented: false,
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    ...overrides,
  };
}

describe("isPlainLeftClick", () => {
  it("accepts a plain left click", () => {
    expect(isPlainLeftClick(clickEvent())).toBe(true);
  });

  it("rejects when already prevented", () => {
    expect(isPlainLeftClick(clickEvent({ defaultPrevented: true }))).toBe(false);
  });

  it("rejects a non-primary button (middle/right click)", () => {
    expect(isPlainLeftClick(clickEvent({ button: 1 }))).toBe(false);
    expect(isPlainLeftClick(clickEvent({ button: 2 }))).toBe(false);
  });

  it("rejects every modifier key individually", () => {
    expect(isPlainLeftClick(clickEvent({ metaKey: true }))).toBe(false);
    expect(isPlainLeftClick(clickEvent({ ctrlKey: true }))).toBe(false);
    expect(isPlainLeftClick(clickEvent({ shiftKey: true }))).toBe(false);
    expect(isPlainLeftClick(clickEvent({ altKey: true }))).toBe(false);
  });
});

describe("combineQuickViewEdits", () => {
  const base = {
    savedStrokeWidth: undefined,
    colorOverride: "#f783ac",
    cssStyleable: false,
    canRecolor: true,
    rotate: 0 as const,
    flipH: false,
    flipV: false,
    padding: 0,
  };

  it("applies the color override when the tier can recolor and css-styleable is off", () => {
    expect(combineQuickViewEdits(base).color).toBe("#f783ac");
  });

  it("suppresses the color override when css-styleable is on", () => {
    expect(combineQuickViewEdits({ ...base, cssStyleable: true }).color).toBeUndefined();
  });

  it("suppresses the color override when the tier cannot recolor", () => {
    expect(combineQuickViewEdits({ ...base, canRecolor: false }).color).toBeUndefined();
  });

  it("passes the collection's saved stroke width straight through, untouched", () => {
    expect(combineQuickViewEdits({ ...base, savedStrokeWidth: 1.5 }).strokeWidth).toBe(1.5);
    expect(combineQuickViewEdits(base).strokeWidth).toBeUndefined();
  });

  it("carries cssStyleable through as given", () => {
    expect(combineQuickViewEdits({ ...base, cssStyleable: true }).cssStyleable).toBe(true);
  });

  it("collapses an untouched rotate (0) to undefined, keeps a real one", () => {
    expect(combineQuickViewEdits(base).rotate).toBeUndefined();
    expect(combineQuickViewEdits({ ...base, rotate: 90 }).rotate).toBe(90);
  });

  it("collapses an untouched padding (0) to undefined, keeps a real one", () => {
    expect(combineQuickViewEdits(base).padding).toBeUndefined();
    expect(combineQuickViewEdits({ ...base, padding: 0.1 }).padding).toBe(0.1);
  });

  it("passes flip flags straight through", () => {
    expect(combineQuickViewEdits({ ...base, flipH: true, flipV: true })).toMatchObject({
      flipH: true,
      flipV: true,
    });
  });
});
