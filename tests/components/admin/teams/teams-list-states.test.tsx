/**
 * What the Teams directory says about its own state.
 *
 * The count badge showed the rows on screen, so forty teams at ten a page
 * badged themselves 10. A failed member request showed "This team has no
 * members", which is a claim about the team made out of an outage. And the
 * pagination went with the rows: emptying the last page left no way back.
 */
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const { TeamsList, TeamMembersBody } =
  await import("@/components/admin/teams/teams-list");

const team = {
  id: 5,
  name: "Acme",
  slug: "acme",
  owner_id: 1,
  owner_email: "owner@example.com",
  owner_name: "Owner",
  owner_avatar_url: null,
  member_count: 1,
  created_at: "2026-01-01T00:00:00Z",
};

function props(over: Record<string, unknown> = {}) {
  return {
    teams: [team],
    teamsLoading: false,
    teamsSearch: "",
    setTeamsSearch: () => {},
    fetchTeams: () => {},
    teamsTotalPages: 4,
    teamsPage: 1,
    teamsPageSize: 10,
    setTeamsPageSize: () => {},
    handleTeamRename: async () => ({ ok: true }),
    handleTeamDelete: () => {},
    fetchTeamMembers: () => {},
    teamMembers: null,
    setTeamMembers: () => {},
    teamMembersLoading: false,
    actionLoading: null,
    callerRole: "super_admin",
    ...over,
  };
}

describe("Team Directory count badge", () => {
  it("shows the total across pages, not the rows on screen", () => {
    const html = renderToStaticMarkup(
      <TeamsList {...props({ teamsTotal: 40 })} />,
    );
    expect(html).toMatch(/tabular-nums[^>]*>40<\/div>/);
  });

  it("falls back to the rows on screen before the total is known", () => {
    const html = renderToStaticMarkup(<TeamsList {...props()} />);
    expect(html).toMatch(/tabular-nums[^>]*>1<\/div>/);
  });
});

describe("pagination", () => {
  it("stays drawn on a later page that has no rows, so the operator can go back", () => {
    const html = renderToStaticMarkup(
      <TeamsList {...props({ teams: [], teamsPage: 3, teamsTotal: 20 })} />,
    );
    expect(html).toContain('aria-label="Previous page"');
  });

  it("is not drawn for an empty first page", () => {
    const html = renderToStaticMarkup(
      <TeamsList {...props({ teams: [], teamsPage: 1, teamsTotal: 0 })} />,
    );
    expect(html).not.toContain('aria-label="Previous page"');
  });
});

describe("the member list in the team modal", () => {
  const render = (over: Record<string, unknown>) =>
    renderToStaticMarkup(
      <TeamMembersBody
        loading={false}
        error={null}
        members={[]}
        onRetry={() => {}}
        {...over}
      />,
    );

  it("says the request failed, with a retry, instead of that the team is empty", () => {
    const html = render({ error: "Couldn't load the members of this team." });
    expect(html).toContain("Couldn&#x27;t load the members of this team.");
    expect(html).toContain("Try again");
    expect(html).not.toContain("This team has no members");
  });

  it("still says an empty team is empty", () => {
    expect(render({})).toContain("This team has no members.");
  });

  it("lists the members it was given", () => {
    const html = render({
      members: [
        {
          user_id: 9,
          email: "ada@example.com",
          name: "Ada",
          avatar_url: null,
          role: "owner",
        },
      ],
    });
    expect(html).toContain("Ada");
    expect(html).not.toContain("Try again");
  });
});
