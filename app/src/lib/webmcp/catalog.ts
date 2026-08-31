/**
 * The WebMCP tools this site hands to a browser agent, described for people.
 *
 * The tool modules next to this file are written for the agent: long
 * descriptions, input schemas, error strings. This is the other half - one
 * short human sentence per tool, grouped by the page the tool lives on, so
 * /agents can list what an agent can actually do here without anyone
 * retyping the list into a page and letting it drift.
 *
 * catalog.test.ts asserts these names are exactly the names the tool modules
 * register: no tool described here that does not exist, none registered that
 * this page forgets. The count in copy comes from WEBMCP_TOOL_COUNT, never
 * from a hand-typed number.
 */

/** One tool, said in a sentence a visitor understands. */
export interface WebMcpToolNote {
  /** The name the agent calls, exactly as registered. */
  name: string;
  /** What the person watching sees it do. */
  does: string;
}

/** The tools that exist while one kind of page is open. */
export interface WebMcpSurface {
  /** The page, named the way a visitor would name it. */
  surface: string;
  /** Where that is on the site. */
  where: string;
  tools: WebMcpToolNote[];
}

export const WEBMCP_SURFACES: WebMcpSurface[] = [
  {
    surface: "The icon library",
    where: "/search",
    tools: [
      {
        name: "search_icons",
        does: "Runs a search and fills the grid you are looking at with the results.",
      },
      {
        name: "refine_search",
        does: "Flips the same filters you would click - set, style, license, no-attribution.",
      },
      { name: "open_icon", does: "Opens one icon's own page in the tab." },
      {
        name: "get_search_state",
        does: "Reads what is on screen: the query, the active filters, how many icons matched.",
      },
    ],
  },
  {
    surface: "An icon page",
    where: "every icon, for example /tabler/star",
    tools: [
      {
        name: "get_icon",
        does: "Reads the icon: its set, its license, what the artwork can be restyled to.",
      },
      {
        name: "style_icon",
        does: "Moves the restyling controls - size, color, stroke, rotation, flips, padding - so the preview changes in front of you.",
      },
      {
        name: "get_icon_code",
        does: "Reads the icon's code in one export format, styled the way the page has it.",
      },
      {
        name: "download_icon",
        does: "Starts the same download the Download button starts.",
      },
    ],
  },
  {
    surface: "A collection",
    where: "/collections, when you are signed in",
    tools: [
      {
        name: "get_collection",
        does: "Reads the open collection: its name, every icon in it, the look they share.",
      },
      {
        name: "add_icon_to_collection",
        does: "Saves one icon into it - the tile appears in your grid straight away.",
      },
      {
        name: "remove_icon_from_collection",
        does: "Takes one icon back out again.",
      },
      {
        name: "set_collection_styles",
        does: "Gives every icon in the collection one shared look.",
      },
      {
        name: "open_add_icons_panel",
        does: "Opens the Add icons panel with a search already run, and leaves the choice to you.",
      },
      {
        name: "download_collection",
        does: "Downloads the whole collection as a zip, with the licenses listed.",
      },
    ],
  },
  {
    surface: "Your dashboard",
    where: "/dashboard, when you are signed in",
    tools: [
      {
        name: "list_collections",
        does: "Lists the collections you already have.",
      },
      { name: "create_collection", does: "Makes a new, empty one." },
    ],
  },
];

/** How many tools the site registers in total. Copy quotes this, not a number. */
export const WEBMCP_TOOL_COUNT = WEBMCP_SURFACES.reduce(
  (total, surface) => total + surface.tools.length,
  0,
);
