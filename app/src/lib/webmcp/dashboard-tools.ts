/**
 * The WebMCP tools the dashboard (/dashboard) offers to an agent.
 *
 * Two tools, both about the signed-in person's own collections: read the
 * list, and make a new one. They exist so an agent can get from "help me
 * build a settings-screen icon set" to a collection page - where
 * collection-tools.ts takes over and the real work happens in front of the
 * human.
 *
 * Same rules as every other tool module here (see search-tools.ts): pure,
 * driven by a handle the mounted island hands out, and no path to the API
 * that the person's own buttons do not already take. A created collection
 * appears as a row on their dashboard the moment the tool returns.
 *
 * The five-collection cap is the API's, not this file's. When the account is
 * full, the refusal an agent gets is the exact sentence the person would see
 * in the page - no invented workaround, and nothing to buy: they delete or
 * reuse one, and that is the whole story.
 */

import { MAX_NAME_LENGTH } from "../workspace/limits";
import type { WebMcpTool } from "./bridge";

/** One collection row, as the tools report it. */
export interface DashboardCollectionSummary {
  id: string;
  name: string;
  /** How many icons are saved in it. */
  count: number;
  /** Path to the collection's own workspace page on this site. */
  url: string;
}

export type DashboardCreateResult =
  | { ok: true; collection: DashboardCollectionSummary }
  | { ok: false; error: string };

/**
 * The imperative handle ResourceManager.tsx exposes to these tools.
 *
 * `create` never rejects: a refusal (a full account, a name the API would
 * not take) comes back as `{ ok: false, error }` carrying the API's own
 * sentence, because that sentence is what the person is being shown too.
 */
export interface DashboardToolHandle {
  list(): DashboardCollectionSummary[];
  create(name: string): Promise<DashboardCreateResult>;
}

function readString(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  return typeof value === "string" ? value : undefined;
}

/**
 * Builds the tool set for one mounted dashboard collections section.
 *
 * Pure: pass the result straight to `registerWebMcpTools`.
 */
export function createDashboardTools(handle: DashboardToolHandle): WebMcpTool[] {
  return [
    {
      name: "list_collections",
      title: "List the person's collections",
      description:
        "List the collections on the signed-in person's dashboard: id, name, " +
        "how many icons each holds, and the page URL for each one. Changes " +
        "nothing. Use it before creating anything - people often already have " +
        "a collection for what you are about to start, and a fifth new one " +
        "fills their account. Open a collection's url to work inside it: that " +
        "page offers tools for adding, removing, restyling and downloading " +
        "its icons.",
      annotations: { readOnlyHint: true },
      inputSchema: { type: "object", properties: {} },
      execute() {
        const collections = handle.list();
        return {
          count: collections.length,
          collections,
          note:
            collections.length === 0
              ? "No collections yet. create_collection makes the first one."
              : "Open a collection's url to add, restyle or download its icons.",
        };
      },
    },

    {
      name: "create_collection",
      title: "Create a collection",
      description:
        "Create a new, empty collection on the signed-in person's own " +
        "dashboard - the same thing their 'New collection' button does. The " +
        "row appears in their list immediately. Give it a name a person would " +
        "recognise later ('Settings screen', 'Onboarding icons'), not a " +
        "generated id. An account holds five collections; when it is full " +
        "this returns the same plain refusal the page shows, and the way " +
        "forward is for THEM to delete or reuse one - never try to work around " +
        "it. Check list_collections first. Once it exists, open its url to " +
        "fill it.",
      inputSchema: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: `What to call it, e.g. 'Settings screen'. Up to ${MAX_NAME_LENGTH} characters.`,
          },
        },
        required: ["name"],
      },
      async execute(input) {
        const name = readString(input, "name")?.trim() ?? "";
        if (!name) {
          return { error: "create_collection needs a name - something the person will recognise later, like 'Settings screen'." };
        }
        if (name.length > MAX_NAME_LENGTH) {
          return { error: `Keep the name under ${MAX_NAME_LENGTH} characters.` };
        }

        const result = await handle.create(name);
        if (!result.ok) return { error: result.error };

        return {
          created: true,
          collection: result.collection,
          message: `Created "${result.collection.name}". It is on the person's dashboard now, empty. Open ${result.collection.url} to add icons to it.`,
        };
      },
    },
  ];
}
