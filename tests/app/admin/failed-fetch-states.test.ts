/**
 * A failed request is not an empty answer.
 *
 * content-manager, the team member modal and the AI conversation page each
 * turned a non-2xx response into "No hosts cached", "This team has no members"
 * or "Conversation not found", so an outage read as data. They now say the
 * request failed and offer a retry, and the searches carry a request counter
 * so an older answer cannot land over a newer one.
 *
 * These panels fetch from effects, which a static render never runs, so the
 * checks read the source for the structure that matters, the same way
 * admin-page-wiring does.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..", "..");
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");

/** The text between the first `start` and the next `end` after it. */
function between(source: string, start: string, end: string): string {
  const a = source.indexOf(start);
  expect(a, `${start} not found`).toBeGreaterThan(-1);
  const b = source.indexOf(end, a + start.length);
  return source.slice(a, b === -1 ? undefined : b);
}

describe("content manager", () => {
  const source = read("components", "admin", "features", "content-manager.tsx");
  const fetcher = between(source, "const fetchPage = useCallback", "[]);");

  it("checks res.ok before it trusts the body", () => {
    expect(fetcher).toMatch(/!res\.ok/);
    expect(fetcher).toContain("setLoadError(");
  });

  it("shows an error state with a retry, ahead of the empty states", () => {
    expect(source).toContain('tone="error"');
    expect(source.indexOf("loadError ? (")).toBeLessThan(
      source.indexOf('title="No hosts cached"'),
    );
    expect(source).toContain("Try again");
  });
});

describe("AI conversation page", () => {
  const source = read("app", "admin", "ai-chats", "[id]", "page.tsx");
  const notOk = between(source, "if (!res.ok) {", "}");

  it("reports a failed request as a failure, not as a missing conversation", () => {
    expect(notOk).toContain("setFailed(true)");
    expect(notOk).not.toContain("setNotFound(true)");
  });

  it("offers a retry", () => {
    expect(source).toContain("setAttempt((n) => n + 1)");
    expect(source).toContain("Try again");
  });

  it("clears the previous conversation before loading the next id", () => {
    expect(between(source, "async function load()", "try {")).toContain(
      "setDetail(null)",
    );
  });
});

describe("admin page fetchers", () => {
  const page = read("app", "admin", "page.tsx");

  it("guards the users list and the teams list with a request counter", () => {
    expect(page).toContain("usersRequestRef");
    expect(page).toContain("teamsRequestRef");
    expect(page).toContain("requestId !== usersRequestRef.current");
    expect(
      between(page, "const timeout = setTimeout(async", "}, 300);"),
    ).toContain("usersRequestRef.current");
  });

  it("drops a member response that belongs to another team", () => {
    const members = between(page, "async function fetchTeamMembers", "\n  }\n");
    expect(members).toContain("teamMembersRequestRef.current");
    expect(members).toContain("data.team.id !== teamId");
    expect(members).toContain("setTeamMembersError(");
    expect(members).toMatch(/!res\.ok/);
  });

  it("steps back a page when the one asked for is gone", () => {
    expect(page.match(/pageAfterEmpty\(/g)?.length).toBe(2);
  });

  it("never stores an error body as the selected user", () => {
    expect(page).not.toMatch(/setSelectedUser\(data\)/);
  });
});
