/**
 * Vue and Svelte component export.
 *
 * Both frameworks take SVG attributes as written, so unlike JSX there is no
 * attribute renaming to do - the body passes through untouched. What they need
 * instead is an idiomatic component shell: a single-file component for Vue, a
 * script-plus-markup file for Svelte, each with the props people actually
 * reach for (size, colour, class) and attribute passthrough so anything else
 * lands on the svg.
 *
 * Colour defaults to currentColor, which is what makes an icon behave like
 * text: it inherits from whatever it sits in, and a caller who wants
 * something else passes it.
 */

import type { IconSource, Tier } from "../data";
import { componentName } from "./jsx";
import { applyEdits, type IconEdits } from "./svg-doc";

/** Indents a body so the generated component reads like hand-written code. */
function indent(body: string, spaces: number): string {
  return body
    .split("\n")
    .map((line) => `${" ".repeat(spaces)}${line}`)
    .join("\n");
}

export function toVueComponent(
  icon: IconSource,
  edits: IconEdits,
  tier: Tier,
  options: { typescript?: boolean } = {},
): string {
  const body = applyEdits(icon, edits, tier);
  const setup = options.typescript
    ? `<script setup lang="ts">
withDefaults(
  defineProps<{ size?: number | string; color?: string }>(),
  { size: "1em", color: "currentColor" },
);
</script>`
    : `<script setup>
defineProps({
  size: { type: [Number, String], default: "1em" },
  color: { type: String, default: "currentColor" },
});
</script>`;

  return `${setup}

<template>
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 ${icon.width} ${icon.height}"
    :width="size"
    :height="size"
    :color="color"
    v-bind="$attrs"
  >
${indent(body, 4)}
  </svg>
</template>
`;
}

export function toSvelteComponent(
  icon: IconSource,
  edits: IconEdits,
  tier: Tier,
  options: { typescript?: boolean } = {},
): string {
  const body = applyEdits(icon, edits, tier);
  const lang = options.typescript ? ' lang="ts"' : "";
  const props = options.typescript
    ? `  let {
    size = "1em",
    color = "currentColor",
    ...rest
  }: { size?: number | string; color?: string } & SVGAttributes<SVGSVGElement> =
    $props();`
    : `  let { size = "1em", color = "currentColor", ...rest } = $props();`;
  const imports = options.typescript
    ? `  import type { SVGAttributes } from "svelte/elements";\n\n`
    : "";

  return `<script${lang}>
${imports}${props}
</script>

<svg
  xmlns="http://www.w3.org/2000/svg"
  viewBox="0 0 ${icon.width} ${icon.height}"
  width={size}
  height={size}
  {color}
  {...rest}
>
${indent(body, 2)}
</svg>
`;
}

/** Suggested filename for a downloaded component. */
export function componentFilename(
  icon: IconSource,
  extension: "vue" | "svelte",
): string {
  return `${componentName(icon.prefix, icon.name)}.${extension}`;
}
