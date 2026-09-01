/**
 * The WebMCP tools the dashboard (/dashboard) offers to an agent.
 *
 * Two tools, both about the signed-in person's own collections: read the
 * list, and make a new one. They exist so an agent can get from "help me
 * build a settings-screen icon set" to a collection page - where
 * collection-tools.ts takes over and the real work happens in front of the
 * human. Creating one WALKS there too: `create_collection` navigates the tab
 * to the new collection, so one human sentence ("make a collection and add
 * these icons") does not stall on a page change nobody asked the agent to
 * make.
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
  /** Navigates the tab to `url` (the new collection's own page), exactly as
      clicking its row does. */
  navigate(url: string): void;
}

/** Whether `create_collection` should follow the new collection, i.e. do what
    a person does after clicking "New collection": open the thing they just
    made. Default true; `open: false` is for an agent that is only setting a
    collection up for later and wants to stay on the dashboard. */
function readOpen(input: Record<string, unknown>): boolean {
  return input["open"] === false ? false : true;
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
        "it. Check list_collections first. Creating one also OPENS it: the " +
        "browser goes to the new collection's page, the same place the person " +
        "lands when they click the new row, so you can carry straight on and " +
        "fill it. That page offers its own tools - add an icon, open the Add " +
        "icons panel (which brings icon search with it), set the shared look, " +
        "download - so the normal flow is create_collection and then keep " +
        "working there. Pass open: false only when you are setting a " +
        "collection up for later and want to stay on the dashboard.",
      inputSchema: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: `What to call it, e.g. 'Settings screen'. Up to ${MAX_NAME_LENGTH} characters.`,
          },
          open: {
            type: "boolean",
            description:
              "Whether to open the new collection's page once it exists (default true). " +
              "false leaves the browser on the dashboard.",
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

        const { collection } = result;
        if (!readOpen(input)) {
          return {
            created: true,
            opened: false,
            collection,
            message: `Created "${collection.name}". It is on the person's dashboard now, empty. Open ${collection.url} when you want to fill it - the collection's own tools live on that page.`,
          };
        }

        /* Navigating is a FULL page load, so this page's tools - these two -
           go away with it. That is correct: the dashboard's tools describe the
           dashboard. The collection page registers its own on arrival. */
        handle.navigate(collection.url);
        return {
          created: true,
          opened: true,
          collection,
          message:
            `Created "${collection.name}" and the browser is now navigating to ${collection.url} - ` +
            "the person watches the collection page open. Once it has loaded, the dashboard tools " +
            "are gone and the collection's own tools are available there: add_icon_to_collection, " +
            "open_add_icons_panel (its search comes with it), set_collection_styles, " +
            "get_collection, remove_icon_from_collection and download_collection. Carry on in " +
            "that page.",
        };
      },
    },
  ];
}
