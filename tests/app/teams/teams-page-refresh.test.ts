/**
 * /teams after a mutation: the page refreshes in place instead of re-opening
 * the team, a double submit sends once, a refused create explains itself inside
 * the dialog, and the withdraw-invite dialog does not offer two Cancels.
 *
 * The page cannot be rendered under this node-only Vitest config, so the wiring
 * is asserted from source (the way tests/components/teams/teams-page-wiring
 * does) and the one piece of behaviour that is pure, runOnce, is driven for
 * real against a fetch stub.
 */
import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { runOnce } from "@/components/teams/run-once";

const ROOT = path.resolve(__dirname, "../../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const PAGE = read("app/teams/page.tsx");

function handler(name: string): string {
  const start = PAGE.search(new RegExp(`\\n  (?:async )?function ${name}\\(`));
  expect(start, `${name} not found`).toBeGreaterThan(-1);
  const rest = PAGE.slice(start + 1);
  const next = rest.slice(1).search(/\n  (?:async )?function \w+\(/);
  return next === -1 ? rest : rest.slice(0, next + 1);
}

describe("refreshing after remove, role change and withdraw", () => {
  it.each(["handleRemoveMember", "handleChangeRole", "handleCancelInvite"])(
    "%s reloads members and the team list without reopening the team",
    (name) => {
      const body = handler(name);
      expect(body).toContain(
        "Promise.all([refreshMembers(selectedTeam), fetchTeams()])",
      );
      // openTeam pushes a history entry and resets the invite link and the
      // member-scans panel.
      expect(body).not.toContain("openTeam(");
      expect(body).not.toContain("setTeamParam(");
      expect(body).not.toContain("setViewingMember(null)");
    },
  );

  it("keeps the copy-once link on screen when another invite is withdrawn", () => {
    const body = handler("handleCancelInvite");
    // The only place the token is dropped is the guarded branch for the
    // invite the link belongs to.
    expect(body.match(/setInviteToken\(/g)).toHaveLength(1);
    expect(body).toMatch(
      /invitedEmail\.trim\(\)\.toLowerCase\(\) === withdrawn\.email\.trim\(\)\.toLowerCase\(\)/,
    );
    expect(body.indexOf("setInviteToken(")).toBeGreaterThan(
      body.indexOf("invitedEmail"),
    );
  });

  it("only the open-team path writes the URL", () => {
    // openTeam is called from the list's onOpenTeam and nowhere else.
    expect(PAGE.match(/openTeam\(/g)).toHaveLength(1);
    expect(PAGE).toContain("onOpenTeam={openTeam}");
  });
});

describe("sending an invite twice", () => {
  it("handleInvite runs under the in-flight guard", () => {
    const body = handler("handleInvite");
    expect(body).toContain("runOnce(invitingRef");
    expect(PAGE).toContain("const invitingRef = useRef(false)");
  });

  it("two synchronous submits make one request", async () => {
    const flag = { current: false };
    const fetchStub = vi.fn(async () => {
      await Promise.resolve();
      return { ok: true };
    });
    const submit = () => runOnce(flag, async () => void (await fetchStub()));
    // Enter pressed twice in one tick: neither call has returned yet.
    await Promise.all([submit(), submit()]);
    expect(fetchStub).toHaveBeenCalledTimes(1);
  });

  it("releases the guard after a failure so the person can try again", async () => {
    const flag = { current: false };
    const attempt = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("Address already invited"))
      .mockResolvedValueOnce(undefined);
    await expect(runOnce(flag, attempt)).rejects.toThrow("already invited");
    expect(flag.current).toBe(false);
    await runOnce(flag, attempt);
    expect(attempt).toHaveBeenCalledTimes(2);
  });

  it("names the invited address on the link card, which outlives the field", () => {
    expect(handler("handleInvite")).toContain("setInvitedEmail(email)");
    expect(PAGE).toMatch(/<TeamInviteLinkCard[\s\S]*?email=\{invitedEmail\}/);
  });
});

describe("a refused create", () => {
  const body = handler("handleCreateTeam");

  it("posts its reason to the dialog, not to the banner behind the scrim", () => {
    const refused = body.slice(
      body.indexOf("if (!res.ok)"),
      body.indexOf("return;"),
    );
    expect(refused).toContain("setCreateError(");
    expect(refused).not.toContain("setActionError(");
    const unreachable = body.slice(body.lastIndexOf("} catch {"));
    expect(unreachable).toContain("setCreateError(");
  });

  it("clears the last error on every attempt and every opening", () => {
    expect(body).toContain("setCreateError(null)");
    expect(PAGE).toMatch(
      /onShowCreate=\{\(\) => \{\s*setCreateError\(null\);\s*setShowCreate\(true\);/,
    );
  });

  it("hands the error to TeamCreateDialog", () => {
    expect(PAGE).toMatch(/<TeamCreateDialog[\s\S]*?error=\{createError\}/);
  });
});

describe("the withdraw-invite dialog", () => {
  const copy = PAGE.slice(
    PAGE.indexOf("const CONFIRM_COPY"),
    PAGE.indexOf("function confirmDescription"),
  );

  it("withdraws, and keeps, instead of cancelling a cancel", () => {
    expect(copy).toContain('confirmLabel: "Withdraw invite"');
    expect(copy).toContain('cancelLabel: "Keep invite"');
    expect(copy).not.toContain('confirmLabel: "Cancel invite"');
    expect(PAGE).toContain("cancelLabel: CONFIRM_COPY[c.kind].cancelLabel");
  });

  it("no dialog's confirm button repeats the default dismiss verb", () => {
    // ConfirmDialog's dismiss button is "Cancel" unless a cancelLabel is given.
    const entries = copy.match(/\{\s*title: "[^}]*\}/g) ?? [];
    expect(entries.length).toBe(4);
    for (const entry of entries) {
      if (entry.includes("cancelLabel")) continue;
      expect(entry).not.toMatch(/confirmLabel: "[^"]*Cancel/);
    }
  });
});

describe("copying the invite link", () => {
  it("goes through useCopyFeedback, not a hand-rolled timer", () => {
    expect(PAGE).toContain('from "@/components/shared/copy-feedback"');
    expect(PAGE).toContain("useCopyFeedback()");
    expect(PAGE).not.toContain("copyToClipboard");
    expect(PAGE).not.toContain("setTimeout");
    expect(PAGE).toContain("copied={linkCopied !== null}");
  });
});
