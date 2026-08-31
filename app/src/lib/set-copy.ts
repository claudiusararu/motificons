/**
 * Plain-language capability sentence for a set card.
 *
 * A visitor does not know what "RECOLOR AND RESIZE" or "CC-BY-SA-4.0" means,
 * and a card is the wrong place to teach them. One sentence, combining what
 * you can do to the icons with what the licence asks of you, in words someone
 * can act on. The tier and SPDX labels stay on the set detail page, where the
 * explainer cards give them context.
 */

import type { Tier } from "./data";

const CAPABILITY: Record<Tier, string> = {
  T1: "Restyles fully to your look",
  T2: "Recolor and resize",
  T3: "Recolor and resize",
  T4: "Ships as drawn",
};

export function setCardSentence(
  tier: Tier,
  attributionRequired: boolean,
): string {
  const credit = attributionRequired ? "credit required" : "no credit needed";
  return `${CAPABILITY[tier]} - free, ${credit}`;
}
