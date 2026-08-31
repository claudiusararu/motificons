---
title: "SVG to JSX: Turning Icons into React Components"
description: "Paste a raw SVG into a React component and it breaks in small, confusing ways - class vs className, kebab-case attributes, style strings. Here is exactly what has to change, and when a dedicated icon package is the better call."
pubDate: 2026-08-13
tags: ["react", "svg", "jsx"]
---

You found the perfect icon, opened the SVG file, copied the markup, and pasted it straight into your component. React throws a wall of warnings, or worse, it silently renders wrong. `class` did nothing. The `stroke-width` attribute is being ignored. Something about "unknown property" scrolls past in the console before you can read it.

This is not a React bug and it is not a broken SVG. JSX is not HTML, and SVG markup was written for HTML's rules, not JSX's. The two look close enough that copy-paste feels like it should just work, which is exactly what makes the failure confusing - a completely different markup language would not trick you into trying this in the first place.

## What actually has to change

JSX compiles to `React.createElement` calls, and React's DOM renderer expects DOM property names, not HTML attribute names. Most of the time those are identical, which is why plain HTML mostly works unmodified in JSX. SVG is where they diverge the most, because SVG has a lot of hyphenated attributes that HTML simply does not.

Here is a small icon before and after:

```html
<!-- Raw SVG -->
<svg class="icon" stroke-width="2" viewBox="0 0 24 24">
  <path d="M12 5v14M5 12h14" stroke-linecap="round" />
</svg>
```

```jsx
// As a JSX component
function PlusIcon(props) {
  return (
    <svg className="icon" strokeWidth={2} viewBox="0 0 24 24" {...props}>
      <path d="M12 5v14M5 12h14" strokeLinecap="round" />
    </svg>
  );
}
```

Three things changed, and they cover most of what breaks in practice:

- `class` became `className` - the single most common one, and the reason for most of the console warnings people see first.
- `stroke-width` became `strokeWidth`, and its value became a number in braces rather than a quoted string - JSX attributes are JavaScript expressions, not text.
- `stroke-linecap` became `strokeLinecap` - same kebab-to-camel rule, applied consistently.

`viewBox` did not need to change because it was already camelCased in the source SVG spec itself - a reminder that this is not a blanket "replace every hyphen" operation, it is attribute-by-attribute.

## The camelCase gotchas

The general rule is kebab-case becomes camelCase, but SVG has enough hyphenated attributes that it is worth having the actual list in front of you instead of guessing:

- `stroke-width` -> `strokeWidth`
- `stroke-linecap` -> `strokeLinecap`
- `stroke-linejoin` -> `strokeLinejoin`
- `stroke-dasharray` -> `strokeDasharray`
- `fill-rule` -> `fillRule`
- `clip-rule` -> `clipRule`
- `clip-path` -> `clipPath`
- `stop-color` -> `stopColor`
- `stop-opacity` -> `stopOpacity`
- `font-family` -> `fontFamily`
- `text-anchor` -> `textAnchor`
- `xlink:href` -> `xlinkHref` (or plain `href` if you are targeting SVG2-aware browsers only)
- `class` -> `className`
- `tabindex` -> `tabIndex`

A `style` attribute is a separate trap: HTML and raw SVG accept `style="fill:red;stroke-width:2"` as a plain string, but JSX wants an object - `style={{ fill: "red", strokeWidth: 2 }}` - with the same camelCase rule applying inside the object too.

## When to use currentColor

If you want an icon to inherit whatever text color it is placed in - matching a button label, following a dark-mode swap, whatever the surrounding CSS decides - set its fill or stroke to `currentColor` instead of a fixed hex value, and let color be controlled from outside the component via CSS or a `color` prop on a wrapping element. This is the difference between an icon that behaves like a font glyph (inherits, themes for free) and one that is permanently whatever color it happened to be exported in. For an icon you plan to drop into more than one place, `currentColor` is almost always the right default; a fixed color makes sense only for a genuinely brand-locked mark that should look identical everywhere.

Multicolor icons complicate this. If your source SVG has several distinct fills - a two-tone icon, a small illustration - replacing every fill with `currentColor` collapses it back to one color and probably breaks the design. In that case, leave the deliberate multicolor fills as they are and only swap `currentColor` in for the parts that were genuinely meant to be "whatever color the surrounding text is," usually a single-color line icon rather than an illustration.

## The fast way to do this

If you just need one icon converted right now, use the free [SVG to JSX converter](/tools/svg-to-jsx) - paste the SVG, get a React component back with every attribute already renamed correctly. It runs entirely in your browser, nothing is uploaded. There is also a typed [SVG to TSX](/tools/svg-to-tsx) version if your project is TypeScript, with props already typed as `SVGProps<SVGSVGElement>`.

And if the icon you need is already in the [library](/search), you do not need the converter at all - every icon's detail page offers a direct JSX (and TSX) copy button alongside SVG, PNG and the other export formats, already converted.

## When a real icon package is the better call

Converting one SVG at a time is right for a one-off icon, a custom mark, or a brand logo that is not going to be in any npm package. It is the wrong tool if what you actually need is dozens or hundreds of consistently-styled icons wired into your app with proper tree-shaking, a stable API, and one place to upgrade from. For that, a dedicated icon component library - installed as a real dependency, imported per-component - is the better call: you get versioning, smaller bundles (only the icons you import ship), and a team that maintains consistency across the whole set for you.

The honest line: reach for a converter or a single exported component when you need one specific icon, especially one your icon package does not have. Reach for an installed package when you need many icons and want them to stay consistent and easy to update without you doing the maintenance by hand.
