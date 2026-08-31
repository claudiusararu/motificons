/** SVG as a base64 data URI, usable in an img src, a CSS background-image or a mask-image. */

/** Isomorphic: the editor produces exports in the browser, endpoints on Node. */
function toBase64(input: string): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(input, "utf8").toString("base64");
  }
  const bytes = new TextEncoder().encode(input);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function toBase64DataUri(svg: string): string {
  return `data:image/svg+xml;base64,${toBase64(svg)}`;
}
