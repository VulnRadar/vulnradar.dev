/**
 * What the User Directory says when the list is not the whole story.
 *
 * Deleting the last row on a page left an empty page with no pagination and a
 * false "No users have registered yet". The count badge showed the site-wide
 * total whatever the filters had narrowed the list to. And "1 scans" and
 * "1 API keys" printed in the activity column.
 */
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const { UsersTab } = await import("@/components/admin/users/users-tab");

const user = {
  id: 7,
  email: "ada@example.com",
  name: "Ada",
  role: "user",
  plan: "free",
  gifted_plan: null,
  gift_end_date: null,
  disabled_at: null,
  totp_enabled: false,
  avatar_url: null,
  created_at: "2026-01-01T00:00:00Z",
  scan_count: 1,
  api_key_count: 1,
};

function props(over: Record<string, unknown> = {}) {
  return {
    stats: null,
    users: [user],
    page: 1,
    totalPages: 3,
    total: 21,
    pageSize: 10,
    searchQuery: "",
    onSearchQueryChange: () => {},
    searchLoading: false,
    filters: { status: "all", role: "all", plan: "all" },
    onFiltersChange: () => {},
    sort: { column: null, direction: null },
    onToggleSort: () => {},
    onRefresh: () => {},
    onPageChange: () => {},
    onPageSizeChange: () => {},
    onOpenUser: () => {},
    ...over,
  };
}

const render = (over: Record<string, unknown> = {}) =>
  renderToStaticMarkup(
    <UsersTab
      {...(props(over) as unknown as Parameters<typeof UsersTab>[0])}
    />,
  );

describe("User Directory", () => {
  it("badges the rows behind the current filters, not the site total", () => {
    expect(render({ total: 3 })).toMatch(/tabular-nums[^>]*>3<\/div>/);
  });

  it("singular counts read as singular", () => {
    const html = render({
      users: [{ ...user, scan_count: "1", api_key_count: "1" }],
    });
    expect(html).toContain("scan</span>");
    expect(html).toContain("</span> API key</span>");
    expect(html).not.toContain("1 scans");
    expect(html).not.toContain("API keys");
  });

  it("plural counts read as plural, including a COUNT that arrives as a string", () => {
    const html = render({
      users: [{ ...user, scan_count: "12", api_key_count: "0" }],
    });
    expect(html).toContain("scans</span>");
    expect(html).toContain("API keys");
  });

  it("an empty page past the first keeps its pagination and does not claim nobody registered", () => {
    const html = render({ users: [], page: 3, total: 21 });
    expect(html).not.toContain("No users have registered yet");
    expect(html).toContain("This page has no accounts left");
    expect(html).toContain('aria-label="Previous page"');
  });

  it("an empty first page with no filters is the one that says nobody registered", () => {
    const html = render({ users: [], page: 1, total: 0 });
    expect(html).toContain("No users have registered yet");
    expect(html).not.toContain('aria-label="Previous page"');
  });
});
