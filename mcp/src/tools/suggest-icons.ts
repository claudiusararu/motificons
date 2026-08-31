/**
 * suggest_icons. v1 = honest baseline: the description is used
 * as-is as a search_icons query over names/tags/aliases via the same shard
 * engine. It is NOT semantic matching - "a settings screen with profile,
 * notifications, privacy" will not decompose into three separate lookups,
 * it searches for that literal phrase. Real curated multi-icon suggestion
 * (semantic ranking, one icon per concept) is not built yet; the tool
 * description says so explicitly so a calling agent calibrates expectations
 * instead of assuming this is smarter than it is.
 */

import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { runSearchIcons } from "./search-icons";

const DEFAULT_COUNT = 8;
const MAX_COUNT = 30;

export const suggestIconsInputSchema = z.object({
  description: z
    .string()
    .describe(
      'What the icon is for, in plain words (e.g. "settings gear", "delete trash can"). v1 treats this as a keyword search over icon names/tags, not a semantic match - short, name-like phrases work better than full sentences.',
    ),
  count: z
    .number()
    .int()
    .positive()
    .max(MAX_COUNT)
    .default(DEFAULT_COUNT)
    .describe(`Max suggestions to return (default ${DEFAULT_COUNT}, max ${MAX_COUNT}).`),
});

export type SuggestIconsInput = z.infer<typeof suggestIconsInputSchema>;

export async function runSuggestIcons(input: SuggestIconsInput): Promise<CallToolResult> {
  return runSearchIcons({
    query: input.description,
    limit: input.count,
  });
}
