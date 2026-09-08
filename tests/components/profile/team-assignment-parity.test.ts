/**
 * A webhook, a scheduled scan and a verified domain can each be handed to a
 * team, and every one of those three PATCH routes accepted `teamId` while
 * nothing in the UI sent it. Team sharing was reachable with curl and nowhere
 * else, the same gap the share-link duration and the webhook rotate/deliveries
 * buttons had before them.
 *
 * Source-text assertions, because this Vitest config runs plain node with no
 * jsdom and a `.tsx` cannot be rendered. What matters here is the wiring: that
 * the control exists on all three, calls the right endpoint with the right
 * field, names itself for a screen reader, and is not offered on a row the
 * server would refuse it on.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

const SHELL = read("components/profile/tabs/profile-developer-tab.tsx");
const WEBHOOKS = read("components/profile/tabs/developer/webhooks-section.tsx");
const SCHEDULES = read(
  "components/profile/tabs/developer/schedules-section.tsx",
);
const DOMAINS = read("components/profile/tabs/developer/domains-section.tsx");
const PICKER = read("components/shared/team-assign-select.tsx");
const HOOK = read("lib/hooks/use-assignable-teams.ts");

/** The body of one function, from its declaration to roughly its end. */
function body(source: string, declaration: string, length = 1400): string {
  const start = source.indexOf(declaration);
  expect(start, `${declaration} not found`).toBeGreaterThan(-1);
  return source.slice(start, start + length);
}

describe("team assignment is reachable from the UI, not only from curl", () => {
  it("sends teamId to PATCH /webhooks/[id]", () => {
    const handler = body(SHELL, "async function handleAssignWebhookTeam");
    expect(handler).toContain("`${API.WEBHOOKS}/${id}`");
    expect(handler).toContain('method: "PATCH"');
    expect(handler).toContain("JSON.stringify({ teamId })");
  });

  it("sends id and teamId to PATCH /schedules", () => {
    // Schedules is the collection route with the id in the body, not a
    // per-resource path like the other two.
    const handler = body(SHELL, "async function handleAssignScheduleTeam");
    expect(handler).toContain("API.SCHEDULES");
    expect(handler).toContain('method: "PATCH"');
    expect(handler).toContain("JSON.stringify({ id, teamId })");
  });

  it("sends teamId to PATCH /domains/[id]", () => {
    const handler = body(DOMAINS, "async function handleAssignTeam");
    expect(handler).toContain("`${API.DOMAINS}/${domain.id}`");
    expect(handler).toContain('method: "PATCH"');
    expect(handler).toContain("JSON.stringify({ teamId })");
  });

  it("gives every picker an accessible name that says which row it belongs to", () => {
    // There is one of these per row, so "Team" on its own would leave a screen
    // reader with a column of identically named selects.
    expect(PICKER).toContain("aria-label={label}");
    expect(WEBHOOKS).toContain("label={`Team for ${wh.name}`}");
    expect(SCHEDULES).toContain(
      "label={`Team for the scheduled scan of ${sch.url}`}",
    );
    expect(DOMAINS).toContain("label={`Team for ${d.domain}`}");
  });

  it("offers 'not assigned to a team' as a real choice, and sends null for it", () => {
    // All three routes take teamId null to move a resource back to personal,
    // so this is the unassign action, not a placeholder.
    expect(PICKER).toContain(
      '<option value="">Not assigned to a team</option>',
    );
    expect(PICKER).toContain(
      'event.target.value === "" ? null : Number(event.target.value)',
    );
  });

  it("renders nothing rather than an empty dropdown for an account with no teams", () => {
    expect(PICKER).toContain(
      "if (teams.length === 0 && value === null) return null;",
    );
  });

  it("keeps a shared resource's team named even when the caller can no longer assign to it", () => {
    // Falling back to the first option would report a shared resource as
    // personal and let the owner overwrite the assignment without noticing.
    expect(PICKER).toContain("currentIsAssignable");
    expect(PICKER).toContain("currentTeamName");
  });

  it("stays a 44px tap target on a phone", () => {
    expect(PICKER).toContain("h-11 sm:h-8");
  });
});

describe("the picker is not offered where the server would refuse it", () => {
  it("shows it only on a webhook the caller created", () => {
    // PATCH /webhooks/[id]: "Only this webhook's owner can change its team",
    // 403, even for a co-member whose role lets them edit and pause it.
    expect(WEBHOOKS).toContain("currentUserId !== null &&");
    expect(WEBHOOKS).toContain("wh.user_id === currentUserId");
  });

  it("shows it only on a schedule the caller created", () => {
    // PATCH /schedules: "Only the schedule's owner can change its team", 403.
    expect(SCHEDULES).toContain("sch.user_id === currentUserId");
  });

  it("shows it only on a domain the caller proved", () => {
    // PATCH /domains/[id] scopes its UPDATE to `user_id = $3` and 404s for
    // anyone else, so there is no read-only variant of this action to offer.
    expect(DOMAINS).toContain("me?.userId != null &&");
    expect(DOMAINS).toContain("d.user_id === me.userId");
  });

  it("lists only teams the caller's role can assign to", () => {
    // getAssignableTeamIds server-side is "role grants manage_scans", and a
    // teamId outside it is a 400. The hook mirrors that rule rather than
    // listing every team the caller happens to be in.
    expect(HOOK).toContain('hasTeamPermission(team.role, "manage_scans")');
    for (const section of [WEBHOOKS, SCHEDULES, DOMAINS]) {
      expect(section).toContain("teams={teams.assignable}");
    }
  });

  it("waits for the team list before drawing a picker at all", () => {
    // "No teams" and "not fetched yet" are different facts. Rendering the
    // second as the first puts a select on every row a beat after the row,
    // and labels an already-shared resource with a placeholder team name.
    for (const section of [WEBHOOKS, SCHEDULES, DOMAINS]) {
      expect(section).toContain("teams.loaded &&");
    }
  });

  it("leaves teamId out of the webhook edit save", () => {
    // A co-member with write access may rename a shared webhook. Folding the
    // team into that same PATCH would 403 the whole edit for them.
    const save = body(SHELL, "async function handleSaveWebhookEdit");
    expect(save).not.toContain("teamId");
  });
});

describe("the caller's teams come from the endpoint that already returns them", () => {
  it("reuses GET /api/v3/teams instead of adding an endpoint", () => {
    expect(HOOK).toContain("fetch(API.TEAMS)");
  });

  it("asks for nothing when teams are turned off for the deployment", () => {
    // Every /api/v3/teams route answers 403 with FEATURE_TEAMS off, so the
    // answer is already known.
    expect(HOOK).toContain("if (!configLoaded || !featureTeams) return;");
  });

  it("tells 'no teams' apart from 'not fetched yet'", () => {
    expect(HOOK).toContain("loaded:");
    expect(HOOK).toContain("teams !== null");
  });
});

describe("a shared resource says so on its row", () => {
  it("names the team on a webhook, a schedule and a domain", () => {
    // The same lists carry resources a teammate created, so "shared" on its
    // own would not say shared with whom.
    expect(WEBHOOKS).toContain("{teamLabel(wh.team_id)}");
    expect(SCHEDULES).toContain("{teamLabel(sch.team_id)}");
    expect(DOMAINS).toContain("{teamLabel(d.team_id)}");
  });

  it("says in the docs that the UI can do it, not only the API", () => {
    // Both pages described teamId as a PATCH field and nothing else, which was
    // accurate right up until this shipped.
    expect(read("app/docs/webhooks/page.tsx")).toContain("the team picker for");
    expect(read("app/docs/scheduled-scans/page.tsx")).toMatch(
      /carries the same picker/,
    );
  });

  it("keeps every em dash out of the copy it added", () => {
    for (const source of [SHELL, WEBHOOKS, SCHEDULES, DOMAINS, PICKER, HOOK]) {
      expect(source).not.toContain("—");
    }
  });
});
