/**
 * Renaming a team from the admin Teams tab.
 *
 * The table row and the phone card each turned into an inline editor, and
 * they disagreed: the desktop one asked "Rename this team?" first and the
 * phone one renamed on the first tap. Both closed the editor before the
 * request came back, so a refused rename lost what was typed. Both now open
 * RenameTeamDialog, whose Save is the one explicit step and which stays open
 * on a refusal.
 *
 * The dialog primitive renders through a portal, which renderToStaticMarkup
 * leaves empty, so it is mocked to pass its children through.
 */
import type { ReactNode } from "react";
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/components/ui/dialog", () => {
  const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return {
    Dialog: Pass,
    DialogBody: Pass,
    DialogContent: Pass,
    DialogDescription: Pass,
    DialogFooter: Pass,
    DialogHeader: Pass,
    DialogTitle: Pass,
  };
});

const { TeamsList } = await import("@/components/admin/teams/teams-list");
const { RenameTeamDialog, renameCandidate } =
  await import("@/components/teams/rename-team-dialog");

const team = {
  id: 5,
  name: "Acme",
  slug: "acme",
  owner_id: 1,
  owner_email: "owner@example.com",
  owner_name: "Owner",
  owner_avatar_url: null,
  member_count: 3,
  created_at: "2026-01-01T00:00:00Z",
};

function listProps() {
  return {
    teams: [team],
    teamsLoading: false,
    teamsSearch: "",
    setTeamsSearch: () => {},
    fetchTeams: () => {},
    teamsTotalPages: 1,
    teamsPage: 1,
    teamsPageSize: 25,
    setTeamsPageSize: () => {},
    handleTeamRename: async () => ({ ok: true }),
    handleTeamDelete: () => {},
    fetchTeamMembers: () => {},
    teamMembers: null,
    setTeamMembers: () => {},
    teamMembersLoading: false,
    actionLoading: null,
    callerRole: "super_admin",
  };
}

describe("the Teams list", () => {
  const html = renderToStaticMarkup(<TeamsList {...listProps()} />);
  const triggers =
    html.match(/<button[^>]*aria-label="Rename Acme"[^>]*>/g) ?? [];

  it("offers a Rename trigger in both the table and the phone card", () => {
    expect(triggers).toHaveLength(2);
  });

  it("keeps each trigger at its touch size", () => {
    expect(triggers.some((t) => /\bh-8 w-8\b/.test(t))).toBe(true);
    expect(triggers.some((t) => /\bh-11 w-11 sm:h-8 sm:w-8\b/.test(t))).toBe(
      true,
    );
  });

  it("never renders an inline name editor", () => {
    expect(html).not.toContain('aria-label="Team name"');
    expect(html).not.toContain("Save team name");
    expect(html).not.toContain("Rename this team?");
  });
});

describe("RenameTeamDialog", () => {
  it("opens on the saved name with Cancel and Rename team", () => {
    const html = renderToStaticMarkup(
      <RenameTeamDialog
        team={team}
        onRename={async () => ({ ok: true })}
        onClose={() => {}}
      />,
    );
    expect(html).toContain("Rename team");
    expect(html).toContain(">Team name</label>");
    expect(html).toMatch(/<input[^>]*value="Acme"/);
    expect(html).toContain(
      "Everyone in Acme sees the new name straight away. They are not told it changed.",
    );
    expect(html).toContain(">Cancel</button>");
    expect(html).toContain(">Rename team</button>");
  });

  it("saves only a real, changed name", () => {
    expect(renameCandidate("Acme", "Acme")).toBeNull();
    expect(renameCandidate("Acme", "  Acme ")).toBeNull();
    expect(renameCandidate("Acme", "   ")).toBeNull();
    expect(renameCandidate("Acme", "Acme Labs")).toBe("Acme Labs");
  });
});
