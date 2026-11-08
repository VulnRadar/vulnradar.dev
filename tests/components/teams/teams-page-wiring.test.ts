/**
 * How /teams reports a failed action: a refused removal, role change, leave,
 * delete, cancel or rename has to say why where the person is looking, instead
 * of closing the dialog and posting the reason above the header.
 *
 * Source-text assertions, because this Vitest config runs plain node with no
 * jsdom and a `.tsx` cannot be imported into a suite. What is asserted is the
 * wiring that decides the behaviour: which handlers throw (so useConfirm keeps
 * its dialog open with the reason), what the rename, invite and role dialogs
 * do on a refusal, and what the Leave button sends. The request helper those handlers share has
 * its own behavioural suite in team-requests.test.ts.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

const PAGE = read("app/teams/page.tsx");

/** One page-level function: from its declaration to the next sibling one. */
function handler(name: string): string {
  const start = PAGE.search(new RegExp(`\\n  (?:async )?function ${name}\\(`));
  expect(start, `${name} not found`).toBeGreaterThan(-1);
  const rest = PAGE.slice(start + 1);
  const next = rest.slice(1).search(/\n  (?:async )?function \w+\(/);
  return next === -1 ? rest : rest.slice(0, next + 1);
}

const CONFIRMED = [
  "handleDelete",
  "handleRemoveMember",
  "handleCancelInvite",
  "handleLeave",
];

describe("the four confirmed actions go through useConfirm", () => {
  it("does not hand-roll the dialog any more", () => {
    expect(PAGE).toContain('from "@/components/shared/use-confirm"');
    expect(PAGE).toContain("useConfirm()");
    expect(PAGE).toContain("{confirmDialog}");
    expect(PAGE).not.toContain("<ConfirmDialog");
    expect(PAGE).not.toContain("setConfirmation");
    expect(PAGE).not.toContain("confirmBusy");
  });

  it("asks before every one of them", () => {
    for (const kind of [
      "deleteTeam",
      "removeMember",
      "cancelInvite",
      "leaveTeam",
    ]) {
      expect(PAGE, kind).toMatch(
        new RegExp(`askConfirmation\\(\\{\\s*kind: "${kind}"`),
      );
    }
  });

  it("runs each action as the confirm's onConfirm, so a throw keeps the dialog open", () => {
    const ask = handler("askConfirmation");
    expect(ask).toContain("confirm({");
    expect(ask).toContain("onConfirm: () => runConfirmation(c)");
    const run = handler("runConfirmation");
    for (const name of CONFIRMED) expect(run, name).toContain(`${name}(`);
  });

  it.each(CONFIRMED)(
    "%s lets a failure throw instead of catching it into the banner",
    (name) => {
      const body = handler(name);
      expect(body).toContain("sendTeamsRequest(");
      // The old shape: catch the failure, post it above the header, return,
      // and let the dialog close as if it had worked.
      expect(body).not.toContain("catch");
      // The one call left clears a stale banner before the attempt.
      expect(body.match(/setActionError\(/g)).toHaveLength(1);
      expect(body).toContain("setActionError(null)");
    },
  );
});

describe("Leave team", () => {
  it("sends the caller's own id, with 'self' only as the not-yet-loaded fallback", () => {
    const body = handler("handleLeave");
    expect(body).toContain("me?.userId");
    expect(body).not.toMatch(/userId: "self"/);
  });
});

describe("changing a role", () => {
  const body = handler("handleChangeRole");

  it("lets a failure throw, so the role dialog stays open with the reason", () => {
    expect(body).toContain("sendTeamsRequest(");
    expect(body).not.toContain("catch");
    expect(body.match(/setActionError\(/g)).toHaveLength(1);
    expect(body).toContain("setActionError(null)");
  });

  it("is the role dialog's save, not a second confirmation", () => {
    expect(PAGE).toContain("onChangeRole={handleChangeRole}");
    expect(PAGE).not.toContain("changeRole");
  });
});

describe("renaming a team", () => {
  const body = handler("handleRename");

  it("takes the new name from the dialog and lets a refusal throw", () => {
    expect(PAGE).toMatch(/async function handleRename\(name: string\)/);
    expect(body).toContain("sendTeamsRequest(");
    // The dialog shows err.message and stays open with what was typed; a
    // catch here would turn a refusal into a rename that looks like it worked.
    expect(body).not.toContain("catch");
    expect(body).not.toContain("finally");
    expect(body).not.toContain("setEditingName");
  });

  it("applies the new name to the open team and reloads the list after the request", () => {
    const afterRequest = body.slice(body.indexOf("sendTeamsRequest("));
    expect(afterRequest).toContain("setSelectedTeam(");
    expect(afterRequest).toContain("fetchTeams()");
  });

  it("keeps no inline-editor state or handlers", () => {
    for (const gone of [
      "editingName",
      "nameInput",
      "savingName",
      "onCancelEdit",
      "onEditName",
      "onSaveName",
      "onNameInputChange",
    ]) {
      expect(PAGE, gone).not.toContain(gone);
    }
    expect(PAGE).toContain("onRename={handleRename}");
  });
});

describe("inviting someone", () => {
  const body = handler("handleInvite");

  it("throws a refusal instead of posting it to the banner", () => {
    expect(body).toContain("throw new Error(");
    expect(body.match(/setActionError\(/g)).toHaveLength(1);
  });

  it("refreshes the lists without resetting the copy-once token", () => {
    expect(body).toContain("refreshMembers(selectedTeam)");
    expect(body).not.toContain("openTeam(");
  });

  it("opens a dialog and renders the link card once it has closed", () => {
    expect(PAGE).toContain("<TeamInviteDialog");
    expect(PAGE).toMatch(/inviteToken && !showInvite/);
    expect(PAGE).toContain("<TeamInviteLinkCard");
    expect(PAGE).not.toContain("TeamInviteForm");
    expect(PAGE).not.toContain("inviteEmail");
  });
});
