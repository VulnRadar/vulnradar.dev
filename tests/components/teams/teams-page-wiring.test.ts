/**
 * How /teams reports a failed action: a refused removal, role change, leave,
 * delete, cancel or rename has to say why where the person is looking, instead
 * of closing the dialog and posting the reason above the header.
 *
 * Source-text assertions, because this Vitest config runs plain node with no
 * jsdom and a `.tsx` cannot be imported into a suite. What is asserted is the
 * wiring that decides the behaviour: which handlers throw (so useConfirm keeps
 * its dialog open with the reason), what the rename editor does on a refusal,
 * and what the Leave button sends. The request helper those handlers share has
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
  "handleChangeRole",
  "handleCancelInvite",
  "handleLeave",
];

describe("the five confirmed actions go through useConfirm", () => {
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
      "changeRole",
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

describe("renaming a team", () => {
  const body = handler("handleRename");

  it("shows the server's reason when the rename is refused", () => {
    expect(body).toContain("sendTeamsRequest(");
    expect(body).toMatch(/catch \(err\) \{[\s\S]*setActionError\(/);
    expect(body).toContain("err.message");
  });

  it("closes the editor only after the rename went through", () => {
    const afterRequest = body.slice(body.indexOf("sendTeamsRequest("));
    const closes = afterRequest.indexOf("setEditingName(false)");
    expect(closes).toBeGreaterThan(-1);
    expect(closes).toBeLessThan(afterRequest.indexOf("catch (err)"));

    // The old handler closed it in `finally`, so every refusal looked like the
    // rename had quietly undone itself.
    const finallyBlock = body.slice(body.indexOf("finally"));
    expect(finallyBlock).not.toContain("setEditingName");
    expect(finallyBlock).toContain("setSavingName(false)");
  });
});
