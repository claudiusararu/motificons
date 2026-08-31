/**
 * audit_repo_icons: the
 * calling agent scans its own repo (imports, loose SVG files, icon-font
 * classes) and SUBMITS what it found; this tool does the analysis server
 * side, against the caller's own curated collection.
 *
 * Everything here is pure/in-memory analysis over data the other collection
 * tools already fetch - no new storage, no new table. Three layers:
 *
 *   1. Classification (classifyIdentifier): a small regex table for the
 *      common icon ecosystems (Font Awesome, Lucide, Heroicons, Tabler,
 *      Material, Feather, Phosphor, Bootstrap Icons, Ionicons, Remix, Ant
 *      Design, Glyphicons) - honest "unrecognized" (null) otherwise. Never
 *      claims more precision than a regex on a string can support.
 *
 *   2. Collection matching (extractIconName + nameSimilarity): each finding's
 *      identifier is reduced to the icon-name part (see extractIconName's own
 *      comment for how, per finding kind), then compared against the
 *      collection's OWN icon names - a small in-memory list (collections cap
 *      at 100 icons, MAX_COLLECTION_ICONS), not a call into the shard search
 *      engine, which indexes the whole 300k-icon library and would be the
 *      wrong tool for "does this repo's icon already exist, under this exact
 *      name, in MY collection." `nameSimilarity` reuses shard-engine.ts's own
 *      `normalize`/`withinDistance` - the same tokenizing and edit-distance
 *      primitives search ranking already trusts - rather than inventing a
 *      second fuzzy-match implementation.
 *
 *   3. Rendering (renderIconInFormat, collection-shared.ts): a finding that
 *      is NOT covered gets its best collection match rendered as a
 *      suggestion, in the collection's remembered export format with its
 *      style settings applied - the exact function get_collection uses per
 *      icon, so a suggestion here and a get_collection entry for the same
 *      icon are always byte-identical. Suggestions are cached per icon id
 *      within one call, since many findings can point at the same
 *      replacement.
 *
 * Verdicts: "covered" (a strong collection match exists), "off-collection"
 * (no strong match, kind is import/icon-font-class/other), "orphan" (no
 * strong match, kind is svg-file - an unmanaged SVG the collection has no
 * opinion on). Orphan is a subset of off-collection by kind, not a separate
 * axis - the report still gives it its own count since SPEC calls out
 * "unmanaged/orphan SVGs" as its own finding category.
 */

import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/server";
import type { Database } from "../../../app/src/db/client";
import { db } from "../../../app/src/db/client";
import { resolveExportSize } from "../../../app/src/lib/collection-download";
import { normalize, withinDistance } from "../../../app/src/lib/search/shard-engine";
import type { IconEdits } from "../../../app/src/lib/transforms";
import { listCollectionItems } from "../../../app/src/lib/workspace/collection-items";
import { getCollectionStyleSettings } from "../../../app/src/lib/workspace/collection-style";
import { listCollections } from "../../../app/src/lib/workspace/collections";
import type { MotificonsAuthExtra } from "../auth";
import {
  errorResult,
  isRenderable,
  renderIconInFormat,
  resolveCollection,
  type RenderableFormat,
  type RenderedIcon,
} from "./collection-shared";

const DEFAULT_PNG_SIZE = 512;

/** A finding scores "covered" at or above this - well past a one-typo
    distance on a short icon name, comfortably below "different word." Tuned
    against the unit tests below, not a magic number picked blind. */
export const COVERED_THRESHOLD = 0.82;

/* ------------------------------------------------------------------------ *
 * Input schema
 * ------------------------------------------------------------------------ */

const findingKindSchema = z.enum(["import", "svg-file", "icon-font-class", "other"]);
export type FindingKind = z.infer<typeof findingKindSchema>;

const findingSchema = z.object({
  kind: findingKindSchema.describe(
    '"import" for a package/component import (e.g. an icon library), "svg-file" for a loose .svg file not served by this library, "icon-font-class" for a CSS icon-font class, "other" for anything else.',
  ),
  identifier: z.string().min(1).describe(
    'The thing found, shaped by "kind": import -> "module: ExportName" (e.g. "lucide-react: ArrowRight"); svg-file -> the file path (e.g. "assets/icons/arrow.svg"); icon-font-class -> the full class string (e.g. "fa fa-arrow-right"); other -> free text.',
  ),
  count: z.number().int().positive().optional().describe("How many times this was found in the repo, if counted. Omit if unknown - treated as 1."),
  path: z.string().optional().describe('Repo-relative file path this was found in (or, for "svg-file", the SVG file itself if not already in "identifier"). Improves svg-file matching by giving a real filename to work from.'),
});

export type Finding = z.infer<typeof findingSchema>;

export const auditRepoIconsInputSchema = z.object({
  findings: z.array(findingSchema).default([]).describe(
    "Everything your scan of the repo turned up: icon library imports, loose .svg files not from this library, and icon-font CSS classes. Submit everything in one call - cheap to collect (grep for import statements, list *.svg files outside node_modules, grep for icon-font class patterns), and the report is most useful when it sees the whole repo at once. An empty list returns a report saying so, not an error.",
  ),
  collection: z.string().optional().describe(
    'Which of your collections to audit against - the source of truth for "on-brand" icons, by name (case-insensitive exact match) or id. Omit to default to your only collection, or your first-created one if you have several (the report\'s "collectionNote" says which, so you know to pass this explicitly next time if that was not the one you meant).',
  ),
});

export type AuditRepoIconsInput = z.infer<typeof auditRepoIconsInputSchema>;

/* ------------------------------------------------------------------------ *
 * Classification - pure, no I/O
 * ------------------------------------------------------------------------ */

interface EcosystemRule {
  set: string;
  pattern: RegExp;
}

/** Deliberately small: the common ecosystems an agent's repo scan is likely
    to actually hit, not an exhaustive registry. A miss here is not a bug -
    it is `classifyIdentifier` returning null and the report saying
    "unrecognized" honestly, per the task brief. */
const ECOSYSTEM_RULES: EcosystemRule[] = [
  { set: "Font Awesome", pattern: /@fortawesome|font-?awesome|react-icons\/fa6?\b|(^|[\s"'/])fa[srlbd]?\s+fa-|(^|[\s"'/])fa-[a-z]/i },
  { set: "Lucide", pattern: /lucide-(react|vue|svelte|solid|static)|(^|[^a-z])lucide(?![a-z-])|react-icons\/lu\b/i },
  { set: "Heroicons", pattern: /@heroicons|heroicons|react-icons\/hi2?\b/i },
  { set: "Tabler Icons", pattern: /@tabler\/icons|tabler-icons|react-icons\/tb\b|(^|[^a-z])tabler(?![a-z])/i },
  { set: "Material Icons", pattern: /@mui\/icons-material|material-icons(?!-)|material-symbols|react-icons\/md\b/i },
  { set: "Material Design Icons", pattern: /(^|[\s"'/])mdi-[a-z]|(^|[^a-z])mdi(?![a-z])/i },
  { set: "Feather", pattern: /react-feather|feather-icons|react-icons\/fi\b|(^|[^a-z])feather(?![a-z])/i },
  { set: "Phosphor", pattern: /@phosphor-icons|phosphor-react|react-icons\/pi\b|(^|[^a-z])phosphor(?![a-z])/i },
  { set: "Bootstrap Icons", pattern: /bootstrap-icons|react-icons\/bs\b|(^|[\s"'/])bi\s+bi-|(^|[\s"'/])bi-[a-z]/i },
  { set: "Ionicons", pattern: /ionicons|react-icons\/io5?\b|(^|[\s"'/])ion-[a-z]/i },
  { set: "Remix Icon", pattern: /remixicon|react-icons\/ri\b|(^|[\s"'/])ri-[a-z]/i },
  { set: "Ant Design Icons", pattern: /@ant-design\/icons|react-icons\/ai\b/i },
  { set: "Glyphicons", pattern: /glyphicon/i },
];

export function classifyIdentifier(identifier: string): string | null {
  for (const rule of ECOSYSTEM_RULES) {
    if (rule.pattern.test(identifier)) return rule.set;
  }
  return null;
}

/* ------------------------------------------------------------------------ *
 * Icon-name extraction - pure, no I/O
 * ------------------------------------------------------------------------ */

function basename(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] ?? path;
}

function stripExtension(name: string): string {
  return name.replace(/\.[a-z0-9]+$/i, "");
}

/** Short class-prefix abbreviations recognized when a single-token
    icon-font identifier arrives with no companion base-class token to
    strip against (e.g. "fa-arrow-right" alone, rather than the more common
    "fa fa-arrow-right"). */
const CLASS_PREFIXES = ["fa", "fas", "far", "fal", "fab", "fad", "bi", "bs", "mdi", "ion", "ri", "gi", "gr"];

/** Reduces one finding to the part worth matching against collection icon
    names. Kind-specific, since "identifier" means something different for
    each:
    - svg-file: identifier (or "path", if given) is a file path - basename
      minus extension is the icon name ("assets/icons/arrow.svg" -> "arrow").
    - import: "module: ExportName" shape - everything after the last colon
      ("lucide-react: ArrowRight" -> "ArrowRight"; nameSimilarity handles the
      PascalCase-to-kebab conversion, not this function).
    - icon-font-class: a full class string, usually "base extra" pairs
      ("fa fa-arrow-right" -> "arrow-right", stripping the "fa-" prefix once
      an earlier token establishes it is the base class); a lone class
      ("fa-arrow-right") strips a known short prefix directly.
    - other / no shape recognized: the identifier verbatim. */
export function extractIconName(finding: { kind: FindingKind; identifier: string; path?: string }): string {
  if (finding.kind === "svg-file") {
    const source = (finding.path && finding.path.trim()) || finding.identifier;
    const stem = stripExtension(basename(source.trim()));
    if (stem) return stem;
  }

  const id = finding.identifier.trim();

  const colonIndex = id.lastIndexOf(":");
  if (colonIndex >= 0 && colonIndex < id.length - 1) {
    return id.slice(colonIndex + 1).trim();
  }

  const tokens = id.split(/\s+/).filter(Boolean);
  if (tokens.length > 1) {
    const last = tokens[tokens.length - 1]!;
    const dash = last.indexOf("-");
    if (dash > 0) {
      const abbrev = last.slice(0, dash).toLowerCase();
      const earlierTokenMatches = tokens.slice(0, -1).some((t) => t.toLowerCase() === abbrev);
      if (earlierTokenMatches || CLASS_PREFIXES.includes(abbrev)) {
        return last.slice(dash + 1);
      }
    }
    return last;
  }

  const dash = id.indexOf("-");
  if (dash > 0 && CLASS_PREFIXES.includes(id.slice(0, dash).toLowerCase())) {
    return id.slice(dash + 1);
  }

  return id;
}

/* ------------------------------------------------------------------------ *
 * Name similarity - pure, reuses shard-engine.ts's normalize/withinDistance
 * ------------------------------------------------------------------------ */

/** camelCase/PascalCase -> word-spaced, so `normalize` (which only splits on
    non-alphanumeric) also breaks "ArrowRight" into ["arrow", "right"] the
    same way it already breaks "arrow-right". */
function splitWords(value: string): string[] {
  const spaced = value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
  return normalize(spaced);
}

/** 0..1. The max of two signals, since either alone under- or over-counts:
    token-set (Jaccard) overlap catches word-order-independent matches
    ("right-arrow" vs "arrow-right") that edit distance scores poorly; edit
    distance on the joined, normalized string catches single-word typos
    ("arow-right" vs "arrow-right") that token overlap treats as a total
    miss (no exact token in common). */
export function nameSimilarity(a: string, b: string): number {
  const tokensA = splitWords(a);
  const tokensB = splitWords(b);
  const joinedA = tokensA.join("-");
  const joinedB = tokensB.join("-");
  if (joinedA === joinedB) return 1;

  const setA = new Set(tokensA);
  const setB = new Set(tokensB);
  const overlap = [...setA].filter((t) => setB.has(t)).length;
  const union = new Set([...setA, ...setB]).size;
  const jaccard = union === 0 ? 0 : overlap / union;

  const maxLen = Math.max(joinedA.length, joinedB.length);
  const distance = maxLen === 0 ? 0 : (withinDistance(joinedA, joinedB, maxLen) ?? maxLen);
  const editSimilarity = maxLen === 0 ? 1 : 1 - distance / maxLen;

  return Math.max(jaccard, editSimilarity);
}

/* ------------------------------------------------------------------------ *
 * Matching against the collection - pure, given a plain list of icon refs
 * ------------------------------------------------------------------------ */

export interface CollectionIconRef {
  /** "prefix:name" */
  id: string;
  name: string;
}

export interface FindingMatch {
  icon: CollectionIconRef;
  score: number;
}

export function bestCollectionMatch(extractedName: string, icons: CollectionIconRef[]): FindingMatch | null {
  let best: FindingMatch | null = null;
  for (const icon of icons) {
    const score = nameSimilarity(extractedName, icon.name);
    if (!best || score > best.score) best = { icon, score };
  }
  return best;
}

export type FindingVerdict = "covered" | "off-collection" | "orphan";

export interface AnalyzedFinding {
  kind: FindingKind;
  identifier: string;
  count: number | null;
  path: string | null;
  extractedName: string;
  recognizedSet: string | null;
  verdict: FindingVerdict;
  match: FindingMatch | null;
}

/** Pure: takes the collection's icons as a plain list (already fetched by
    the caller), no DB/storage access here - this is what makes
    classification/matching/report-assembly unit-testable with no mocks. */
export function analyzeFindings(findings: Finding[], collectionIcons: CollectionIconRef[]): AnalyzedFinding[] {
  return findings.map((finding) => {
    const extractedName = extractIconName(finding);
    const recognizedSet = classifyIdentifier(finding.identifier);
    const match = bestCollectionMatch(extractedName, collectionIcons);
    const covered = match !== null && match.score >= COVERED_THRESHOLD;
    const verdict: FindingVerdict = covered ? "covered" : finding.kind === "svg-file" ? "orphan" : "off-collection";

    return {
      kind: finding.kind,
      identifier: finding.identifier,
      count: finding.count ?? null,
      path: finding.path ?? null,
      extractedName,
      recognizedSet,
      verdict,
      match,
    };
  });
}

/* ------------------------------------------------------------------------ *
 * Report rollups - pure
 * ------------------------------------------------------------------------ */

export interface ClassificationSummary {
  /** Recognized-set name -> weighted count (each finding's own `count`, or
      1 when omitted). */
  bySet: Record<string, number>;
  sets: string[];
  distinctSets: number;
  unrecognizedCount: number;
  mixed: boolean;
}

export function summarizeClassification(analyzed: AnalyzedFinding[]): ClassificationSummary {
  const bySet: Record<string, number> = {};
  let unrecognizedCount = 0;

  for (const finding of analyzed) {
    const weight = finding.count ?? 1;
    if (finding.recognizedSet) {
      bySet[finding.recognizedSet] = (bySet[finding.recognizedSet] ?? 0) + weight;
    } else {
      unrecognizedCount += weight;
    }
  }

  const sets = Object.keys(bySet).sort();
  return { bySet, sets, distinctSets: sets.length, unrecognizedCount, mixed: sets.length > 1 };
}

export interface CoverageSummary {
  covered: number;
  offCollection: number;
  orphanSvgs: number;
}

export function summarizeCoverage(analyzed: AnalyzedFinding[]): CoverageSummary {
  let covered = 0;
  let offCollection = 0;
  let orphanSvgs = 0;
  for (const finding of analyzed) {
    if (finding.verdict === "covered") covered += 1;
    else if (finding.verdict === "orphan") orphanSvgs += 1;
    else offCollection += 1;
  }
  return { covered, offCollection, orphanSvgs };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function buildSummary(params: {
  totalFindings: number;
  collectionName: string | null;
  collectionNote: string | null;
  classification: ClassificationSummary;
  coverage: CoverageSummary;
  collectionEmpty: boolean;
}): string {
  const { totalFindings, collectionName, collectionNote, classification, coverage, collectionEmpty } = params;

  if (totalFindings === 0) {
    return "No findings were submitted - nothing to audit. Pass the imports, SVG files and icon-font classes your scan found, then call again.";
  }

  const parts: string[] = [
    `Audited ${totalFindings} finding${totalFindings === 1 ? "" : "s"}${collectionName ? ` against "${collectionName}"` : ""}.`,
  ];
  if (collectionNote) parts.push(collectionNote);

  if (classification.mixed) {
    parts.push(
      `${classification.distinctSets} different icon sets are mixed in (${classification.sets.join(", ")}) - a common source of visual inconsistency (different stroke widths, corner styles, optical sizes).`,
    );
  } else if (classification.distinctSets === 1) {
    parts.push(`All recognized findings come from one icon set (${classification.sets[0]}).`);
  }

  if (collectionEmpty) {
    parts.push("The collection has no icons yet, so nothing could be matched or suggested - add icons to it first.");
  } else {
    const orphanClause =
      coverage.orphanSvgs > 0
        ? `, and ${coverage.orphanSvgs} orphan SVG file${coverage.orphanSvgs === 1 ? "" : "s"} ${coverage.orphanSvgs === 1 ? "has" : "have"} no collection match`
        : "";
    parts.push(
      `${coverage.covered} already match the collection, ${coverage.offCollection} are off the collection with a suggested replacement below${orphanClause}.`,
    );
  }

  if (classification.unrecognizedCount > 0) {
    parts.push(
      `${classification.unrecognizedCount} finding${classification.unrecognizedCount === 1 ? "" : "s"} could not be classified to a known icon set.`,
    );
  }

  return parts.join(" ");
}

/* ------------------------------------------------------------------------ *
 * Collection resolution with a sole/first-collection default
 * ------------------------------------------------------------------------ */

type ResolveOrDefaultResult =
  | { ok: true; collection: { id: string; name: string }; note: string | null }
  | { ok: false; result: CallToolResult };

export async function resolveCollectionOrDefault(
  database: Database,
  workspaceId: string,
  requested: string | undefined,
): Promise<ResolveOrDefaultResult> {
  if (requested && requested.trim()) {
    const resolved = await resolveCollection(database, workspaceId, requested);
    if (!resolved.ok) return resolved;
    return { ok: true, collection: resolved.collection, note: null };
  }

  const collections = await listCollections(database, workspaceId);
  const [first] = collections;
  if (!first) {
    return {
      ok: false,
      result: errorResult(
        "You don't have any collections yet - create one at motificons.app/dashboard, then run this audit again so findings can be checked against it.",
      ),
    };
  }

  const note =
    collections.length === 1
      ? `No collection specified - defaulted to your only collection, "${first.name}".`
      : `No collection specified - defaulted to your first collection, "${first.name}" (you have ${collections.length}). Pass "collection" to target a different one.`;

  return { ok: true, collection: first, note };
}

/* ------------------------------------------------------------------------ *
 * Orchestration
 * ------------------------------------------------------------------------ */

interface FindingReportEntry {
  kind: FindingKind;
  identifier: string;
  count: number | null;
  path: string | null;
  extractedName: string;
  recognizedSet: string | null;
  verdict: FindingVerdict;
  matchedIcon?: { id: string; name: string; score: number };
  suggestion?: RenderedIcon & { score: number };
}

export async function runAuditRepoIcons(
  input: AuditRepoIconsInput,
  extra: MotificonsAuthExtra,
): Promise<CallToolResult> {
  if (input.findings.length === 0) {
    const classification = summarizeClassification([]);
    const coverage = summarizeCoverage([]);
    const body = {
      collection: null,
      totalFindings: 0,
      classification,
      coverage,
      findings: [] as FindingReportEntry[],
      summary: buildSummary({
        totalFindings: 0,
        collectionName: null,
        collectionNote: null,
        classification,
        coverage,
        collectionEmpty: false,
      }),
    };
    return { content: [{ type: "text", text: JSON.stringify(body, null, 2) }] };
  }

  const database = await db();
  const resolved = await resolveCollectionOrDefault(database, extra.workspaceId, input.collection);
  if (!resolved.ok) return resolved.result;
  const { collection, note: collectionNote } = resolved;

  const [items, style] = await Promise.all([
    listCollectionItems(database, collection.id),
    getCollectionStyleSettings(database, extra.workspaceId, collection.id),
  ]);

  const collectionIcons: CollectionIconRef[] = items.map((item) => {
    const separator = item.iconId.indexOf(":");
    return { id: item.iconId, name: item.iconId.slice(separator + 1) };
  });

  const analyzed = analyzeFindings(input.findings, collectionIcons);
  const classification = summarizeClassification(analyzed);
  const coverage = summarizeCoverage(analyzed);

  const rememberedFormat = style?.exportFormat ?? "svg";
  const downgradedFromCatalog = rememberedFormat === "catalog";
  const format: RenderableFormat = isRenderable(rememberedFormat) ? rememberedFormat : "svg";
  const edits: IconEdits = {
    color: style?.color ?? undefined,
    strokeWidth: style?.strokeWidth ?? undefined,
    size: resolveExportSize(format, DEFAULT_PNG_SIZE, style?.size ?? null),
  };

  /* Many findings can share the same best-match replacement (e.g. five
     off-brand "close" icons from five different libraries all suggest the
     collection's one close icon) - render each candidate at most once. */
  const renderCache = new Map<string, Promise<RenderedIcon>>();
  function renderCached(iconId: string): Promise<RenderedIcon> {
    let pending = renderCache.get(iconId);
    if (!pending) {
      pending = renderIconInFormat(iconId, format, edits);
      renderCache.set(iconId, pending);
    }
    return pending;
  }

  const findings: FindingReportEntry[] = await Promise.all(
    analyzed.map(async (finding): Promise<FindingReportEntry> => {
      const base: FindingReportEntry = {
        kind: finding.kind,
        identifier: finding.identifier,
        count: finding.count,
        path: finding.path,
        extractedName: finding.extractedName,
        recognizedSet: finding.recognizedSet,
        verdict: finding.verdict,
      };

      if (!finding.match) return base;

      if (finding.verdict === "covered") {
        return {
          ...base,
          matchedIcon: { id: finding.match.icon.id, name: finding.match.icon.name, score: round2(finding.match.score) },
        };
      }

      const rendered = await renderCached(finding.match.icon.id);
      return { ...base, suggestion: { ...rendered, score: round2(finding.match.score) } };
    }),
  );

  const body: Record<string, unknown> = {
    collection: { id: collection.id, name: collection.name },
    totalFindings: input.findings.length,
    classification,
    coverage,
    findings,
  };

  if (collectionNote) body.collectionNote = collectionNote;
  if (downgradedFromCatalog) {
    body.formatNote =
      'This collection\'s remembered export format is "catalog" (an Xcode asset-catalog ZIP per icon) - not a useful shape for a tool result, so suggestions are rendered as "svg" instead.';
  }

  body.summary = buildSummary({
    totalFindings: input.findings.length,
    collectionName: collection.name,
    collectionNote,
    classification,
    coverage,
    collectionEmpty: collectionIcons.length === 0,
  });

  return { content: [{ type: "text", text: JSON.stringify(body, null, 2) }] };
}
