/**
 * Every export format the product offers, in one place.
 *
 * Counts are data: the homepage stat, the FAQ answer and
 * the icon detail page's format preview panel all read their tab list from
 * this array, so adding a format updates every surface instead of making one
 * of them quietly wrong.
 *
 * Split out from ./index so client code (the format preview panel) can import
 * it without pulling in ./png, which drags the resvg native binary into the
 * browser bundle - see the barrel's own comment on that.
 */
export const EXPORT_FORMATS = [
  { id: "svg", label: "SVG" },
  { id: "png", label: "PNG" },
  { id: "jsx", label: "React JSX" },
  { id: "tsx", label: "React TSX" },
  { id: "vue", label: "Vue SFC" },
  { id: "svelte", label: "Svelte" },
  { id: "swiftui", label: "SwiftUI" },
  { id: "catalog", label: "Xcode asset catalog" },
  { id: "datauri", label: "Data URI" },
] as const;

export type ExportFormat = (typeof EXPORT_FORMATS)[number]["id"];

/**
 * The subset of export formats that get a dedicated free paste-and-convert
 * tool page. "svg" has no converter page - there is nothing to convert an
 * SVG *to* - and "catalog" (Xcode asset catalog) is deliberately left out. Both app/src/pages/tools/_tool-data.ts and
 * SvgTool.tsx key off this type so the tool list can never drift from the
 * format registry it is drawn from.
 */
export type ToolKind = Exclude<ExportFormat, "svg" | "catalog">;
