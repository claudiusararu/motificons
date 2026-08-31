import { describe, expect, it } from "vitest";
import { magicLinkHtml } from "./mailer";
import { LOGO_CHIP_CONTENT_ID } from "./mailer-assets";

describe("magicLinkHtml", () => {
  const html = magicLinkHtml("https://motificons.app/api/auth/verify?token=abc");

  it("renders the logo chip as a CID inline image, not SVG", () => {
    /* Gmail (and most webmail clients) strip <svg> from message bodies
       entirely - the original template rendered as an empty yellow square
       in Gmail. Superseding the unicode-star fix: the template shows the
       real bolt glyph, which only ships as a raster image -
       delivered as a CID attachment (resendMailer wires the matching
       content_id) rather than a hosted URL, so it works with zero deploy
       dependency. No <svg> anywhere, no data: URI (Gmail strips/blocks
       those too). */
    expect(html).toContain(`src="cid:${LOGO_CHIP_CONTENT_ID}"`);
    expect(html).toContain('alt="Motificons"');
    expect(html).not.toMatch(/<svg/i);
    expect(html).not.toMatch(/<\/svg>/i);
    expect(html).not.toContain("data:image");
    expect(html).not.toContain("&#9733;");
  });

  it("keeps the td's own yellow/border styling as the blocked-images fallback", () => {
    expect(html).toContain("background-color:#ffd43b");
    expect(html).toContain("border:2px solid #183153");
  });

  it("still includes the sign-in link", () => {
    expect(html).toContain("https://motificons.app/api/auth/verify?token=abc");
  });
});
