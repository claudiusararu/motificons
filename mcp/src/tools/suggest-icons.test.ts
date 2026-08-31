import { describe, expect, it, vi } from "vitest";
import type { SearchIconsInput } from "./search-icons";

const runSearchIconsMock = vi.fn(async (_input: SearchIconsInput) => ({
  content: [{ type: "text" as const, text: "{}" }],
}));
vi.mock("./search-icons", () => ({
  runSearchIcons: (input: SearchIconsInput) => runSearchIconsMock(input),
}));

const { runSuggestIcons } = await import("./suggest-icons");

describe("runSuggestIcons", () => {
  it("treats the description as a search_icons query and count as limit (v1: keyword search, not semantic)", async () => {
    await runSuggestIcons({ description: "delete trash can", count: 5 });

    expect(runSearchIconsMock).toHaveBeenCalledWith({
      query: "delete trash can",
      limit: 5,
    });
  });

  it("passes the underlying search result straight through", async () => {
    runSearchIconsMock.mockResolvedValueOnce({
      content: [{ type: "text", text: '{"total":2,"hits":[]}' }],
    });

    const output = await runSuggestIcons({ description: "trash", count: 8 });
    expect(output.content[0]).toEqual({ type: "text", text: '{"total":2,"hits":[]}' });
  });
});
