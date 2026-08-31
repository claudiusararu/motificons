/**
 * Motificons transform library.
 *
 * Plain TypeScript with no framework imports so the same code can back the web
 * editor, the export endpoints and the MCP server. This directory should
 * eventually move to its own workspace package rather than being imported
 * out of the app.
 */

export {
  extractPalette,
  isCurrentColorOnly,
  mapPaints,
  recolor,
  recolorPalette,
  toCurrentColor,
} from "./color";
export {
  hasStroke,
  opticalStrokeTarget,
  retargetStroke,
  strokeRatio,
  strokeWidths,
} from "./stroke";
export {
  applyEdits,
  buildInlineSvg,
  buildSvg,
  capabilitiesFor,
  type IconEdits,
  type TierCapabilities,
} from "./svg-doc";
export { componentName, toJsxBody, toJsxComponent } from "./jsx";
export {
  componentFilename,
  toSvelteComponent,
  toVueComponent,
} from "./components";

export { EXPORT_FORMATS, type ExportFormat } from "./formats";
export { toBase64DataUri } from "./data-uri";
export {
  swiftTypeName,
  toSwiftColor,
  toSwiftUi,
  type SwiftUiKind,
  type SwiftUiResult,
} from "./swiftui";
export {
  assetName,
  contentsJson,
  toAssetCatalog,
  toAssetCatalogBundle,
  type AssetCatalogResult,
} from "./asset-catalog";
export { createZip, crc32, type ZipEntry } from "./zip";
export { collectGeometry, type Geometry, type Subpath } from "./geometry";
export { SWATCHES } from "./swatches";

/* Server only: pulls the resvg native module. Client code must not import
   this barrel - import the leaf modules instead. */
export {
  clampPngSize,
  MAX_PNG_SIZE,
  MIN_PNG_SIZE,
  PNG_SIZES,
  toPng,
} from "./png";
