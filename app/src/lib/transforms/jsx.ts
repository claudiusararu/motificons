/**
 * SVG to a React component.
 *
 * Attribute renaming is done from an explicit table rather than a generic
 * kebab-to-camel rule, because SVG has exceptions in both directions and a
 * blanket rule silently produces attributes React drops on the floor.
 */

import type { IconSource, Tier } from "../data";
import { applyEdits, type IconEdits } from "./svg-doc";

const ATTRIBUTE_MAP: Record<string, string> = {
  "accent-height": "accentHeight",
  "alignment-baseline": "alignmentBaseline",
  "arabic-form": "arabicForm",
  "baseline-shift": "baselineShift",
  "cap-height": "capHeight",
  "clip-path": "clipPath",
  "clip-rule": "clipRule",
  "color-interpolation": "colorInterpolation",
  "color-interpolation-filters": "colorInterpolationFilters",
  "dominant-baseline": "dominantBaseline",
  "fill-opacity": "fillOpacity",
  "fill-rule": "fillRule",
  "flood-color": "floodColor",
  "flood-opacity": "floodOpacity",
  "font-family": "fontFamily",
  "font-size": "fontSize",
  "font-weight": "fontWeight",
  "glyph-name": "glyphName",
  "horiz-adv-x": "horizAdvX",
  "image-rendering": "imageRendering",
  "letter-spacing": "letterSpacing",
  "lighting-color": "lightingColor",
  "marker-end": "markerEnd",
  "marker-mid": "markerMid",
  "marker-start": "markerStart",
  "mask-type": "maskType",
  "paint-order": "paintOrder",
  "pointer-events": "pointerEvents",
  "shape-rendering": "shapeRendering",
  "stop-color": "stopColor",
  "stop-opacity": "stopOpacity",
  "stroke-dasharray": "strokeDasharray",
  "stroke-dashoffset": "strokeDashoffset",
  "stroke-linecap": "strokeLinecap",
  "stroke-linejoin": "strokeLinejoin",
  "stroke-miterlimit": "strokeMiterlimit",
  "stroke-opacity": "strokeOpacity",
  "stroke-width": "strokeWidth",
  "text-anchor": "textAnchor",
  "text-decoration": "textDecoration",
  "text-rendering": "textRendering",
  "underline-position": "underlinePosition",
  "underline-thickness": "underlineThickness",
  "vector-effect": "vectorEffect",
  "word-spacing": "wordSpacing",
  "writing-mode": "writingMode",
  "xlink:href": "xlinkHref",
  "xml:space": "xmlSpace",
  class: "className",
};

const ATTRIBUTE_PATTERN = new RegExp(
  `\\b(${Object.keys(ATTRIBUTE_MAP)
    .map((key) => key.replace(/[:.]/g, "\\$&"))
    .join("|")})\\s*=`,
  "g",
);

/** PascalCase type name, prefixed when the icon name starts with a digit. */
export function componentName(prefix: string, name: string): string {
  const camel = `${prefix}-${name}`
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
  return /^[0-9]/.test(camel) ? `Icon${camel}` : camel;
}

export function toJsxBody(body: string): string {
  /* Inline style="a:b" is a string in SVG and an object in JSX; converting it
     properly needs a real parser, so it is left alone and the rare icon that
     uses it keeps working through dangerouslySetInnerHTML instead. */
  return body.replace(ATTRIBUTE_PATTERN, (_, attribute: string) => {
    return `${ATTRIBUTE_MAP[attribute]}=`;
  });
}

export interface JsxOptions {
  typescript?: boolean;
}

export function toJsxComponent(
  icon: IconSource,
  edits: IconEdits,
  tier: Tier,
  options: JsxOptions = {},
): string {
  const body = toJsxBody(applyEdits(icon, edits, tier));
  const name = componentName(icon.prefix, icon.name);
  const typed = options.typescript ?? false;

  const signature = typed
    ? `export function ${name}(props: SVGProps<SVGSVGElement>) {`
    : `export function ${name}(props) {`;
  const importLine = typed ? 'import type { SVGProps } from "react";\n\n' : "";

  return `${importLine}${signature}
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 ${icon.width} ${icon.height}"
      width="1em"
      height="1em"
      {...props}
    >
      ${body}
    </svg>
  );
}
`;
}
