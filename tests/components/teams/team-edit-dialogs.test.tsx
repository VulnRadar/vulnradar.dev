/**
 * The three edits on a team's page that used to happen in place and now open a
 * modal: rename the team, invite someone, change a member's role.
 *
 * Runs under node with no DOM, so the dialogs are rendered with
 * renderToStaticMarkup and the Dialog primitive passed through (it renders in
 * a portal, which a static render leaves empty). Two seams make the behaviour
 * reachable without a browser:
 *
 *   - EditDialog is wrapped to record the props each site hands it. onSave,
 *     canSave and dirty are the whole contract between a site and the dialog.
 *   - useState is seeded for the first hook a render reaches, which is the
 *     site's draft. A static render never fires an onChange, so this is how a
 *     test "types" into the form.
 *
 * Whether the real dialog stays open on a throw is the dialog's own suite;
 * here runEditSubmit, the function it submits through, is driven with the
 * site's onSave to prove the message that would be shown.
 */
import fs from "node:fs";
import path from "node:path";
import type { ReactNode } from "react";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const seeds: unknown[] = [];

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useState: (initial: unknown) =>
      seeds.length > 0
        ? [seeds.shift(), () => {}]
        : (actual.useState as (i: unknown) => unknown)(initial),
  };
});

vi.mock("@/components/ui/dialog", () => {
  const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return {
    Dialog: Pass,
    DialogBody: Pass,
    DialogClose: Pass,
    DialogContent: Pass,
    DialogDescription: Pass,
    DialogFooter: Pass,
    DialogHeader: Pass,
    DialogOverlay: Pass,
    DialogPortal: Pass,
    DialogTitle: Pass,
    DialogTrigger: Pass,
  };
});

type DialogProps = import("@/components/shared/edit-dialog").EditDialogProps;
const shown: DialogProps[] = [];

vi.mock("@/components/shared/edit-dialog", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/components/shared/edit-dialog")>();
  return {
    ...actual,
    EditDialog: (props: DialogProps) => {
      shown.push(props);
      return createElement(actual.EditDialog, props);
    },
  };
});

const { editCloseDecision, runEditSubmit } =
  await import("@/components/shared/edit-dialog-outcome");
const { TeamDetailHeader } =
  await import("@/components/teams/team-detail-header");
const { RenameTeamDialog, renameCandidate } =
  await import("@/components/teams/rename-team-dialog");
const {
  TeamInviteDialog,
  TeamInviteLinkCard,
  assignableInviteRoles,
  defaultInviteRole,
  inviteRequestBody,
} = await import("@/components/teams/team-invite-form");
const {
  ChangeRoleDialog,
  TeamMembersList,
  canSaveRoleChange,
  roleChangeDescription,
} = await import("@/components/teams/team-members-list");
const { ROLE_ABILITIES } = await import("@/components/teams/teams-types");

import type { Member, Team } from "@/components/teams/teams-types";

const team = {
  id: 7,
  name: "Platform Security",
  slug: "platform-security",
  owner_id: 1,
  owner_email: "owner@example.com",
  owner_name: "Owner",
  owner_avatar_url: null,
  avatar_url: null,
  member_count: 3,
  created_at: "2026-01-01T00:00:00Z",
  role: "owner",
} as Team;

const sam = {
  user_id: 42,
  role: "manager",
  joined_at: "2026-02-01T00:00:00Z",
  name: "Sam Rivera",
  email: "sam@example.com",
} as Member;

/** React escapes an apostrophe in text, so the copy is compared as markup. */
const esc = (text: string) => text.replace(/'/g, "&#x27;");

beforeEach(() => {
  seeds.length = 0;
  shown.length = 0;
});

/** The props the last EditDialog on the page was given. */
function lastDialog(): DialogProps {
  const props = shown[shown.length - 1];
  expect(props, "no EditDialog was rendered").toBeDefined();
  return props;
}

/** Submits the way the dialog does and reports what it would have done. */
async function submit(props: DialogProps) {
  const errors: Array<string | null> = [];
  const closes: number[] = [];
  const result = await runEditSubmit({
    onSave: props.onSave,
    canSave: props.canSave ?? true,
    busy: false,
    setBusy: () => {},
    setError: (m) => errors.push(m),
    close: () => closes.push(1),
  });
  return { result, errors, closes };
}

describe("rename team", () => {
  function renderRename(onRename = vi.fn(), onClose = vi.fn()) {
    const html = renderToStaticMarkup(
      <RenameTeamDialog team={team} onRename={onRename} onClose={onClose} />,
    );
    return { html, onRename, onClose };
  }

  it("opens on the saved name, with a real label, Cancel and the Rename team button", () => {
    const { html } = renderRename();
    const fieldId = html.match(/<label[^>]*for="([^"]+)"/)?.[1];
    expect(fieldId).toBeDefined();
    expect(html).toContain(`id="${fieldId}"`);
    expect(html).toContain('value="Platform Security"');
    // The limit is the MAX_TEAM_NAME_LENGTH setting, checked by the server.
    expect(html).not.toContain("maxLength");
    const props = lastDialog();
    expect(props.title).toBe("Rename team");
    expect(props.saveLabel).toBe("Rename team");
    // Nothing changed yet, so there is nothing to save or to discard.
    expect(props.canSave).toBe(false);
    expect(props.dirty).toBe(false);
  });

  it("allows saving only a trimmed, non-empty name that differs from the saved one", () => {
    expect(
      renameCandidate("Platform Security", "Platform Security"),
    ).toBeNull();
    expect(renameCandidate("Platform Security", "  Platform Security  ")).toBe(
      null,
    );
    expect(renameCandidate("Platform Security", "   ")).toBeNull();
    expect(renameCandidate("Platform Security", "")).toBeNull();
    expect(renameCandidate("Platform Security", "  Red Team ")).toBe(
      "Red Team",
    );
  });

  it("calls onRename with the trimmed name", async () => {
    seeds.push("  Red Team  ");
    const { onRename } = renderRename();
    const props = lastDialog();
    expect(props.canSave).toBe(true);
    expect(props.dirty).toBe(true);

    const { result, closes } = await submit(props);
    expect(onRename).toHaveBeenCalledTimes(1);
    expect(onRename).toHaveBeenCalledWith("Red Team");
    expect(result).toEqual({ kind: "saved" });
    expect(closes).toHaveLength(1);
  });

  it("keeps the dialog open with the server's reason when the rename is refused", async () => {
    seeds.push("X");
    const onRename = vi
      .fn()
      .mockRejectedValue(new Error("Team names need at least 2 characters."));
    renderRename(onRename);

    const { result, errors, closes } = await submit(lastDialog());
    expect(result).toEqual({
      kind: "failed",
      message: "Team names need at least 2 characters.",
    });
    expect(errors).toContain("Team names need at least 2 characters.");
    expect(closes).toHaveLength(0);
  });

  it("never saves on an unchanged name", async () => {
    const { onRename } = renderRename();
    const { result } = await submit(lastDialog());
    expect(result).toBeNull();
    expect(onRename).not.toHaveBeenCalled();
  });

  it("closes on Cancel and Escape without saving", () => {
    seeds.push("Red Team");
    const { onRename, onClose } = renderRename();
    const props = lastDialog();

    // Dirty, so the dialog asks first; either way the save is never called.
    expect(
      editCloseDecision({ busy: false, dirty: props.dirty ?? false }),
    ).toBe("confirm-discard");
    props.onOpenChange(false);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onRename).not.toHaveBeenCalled();
    // The team keeps the name it had.
    expect(team.name).toBe("Platform Security");
  });

  it("asks nothing when Cancel is pressed on an untouched form", () => {
    renderRename();
    expect(
      editCloseDecision({ busy: false, dirty: lastDialog().dirty ?? false }),
    ).toBe("close");
  });
});

describe("the header's Rename team trigger", () => {
  function renderHeader(currentRole: string) {
    return renderToStaticMarkup(
      <TeamDetailHeader
        team={team}
        currentRole={currentRole}
        memberCount={3}
        onBack={() => {}}
        onRename={async () => {}}
        onInvite={() => {}}
        onDelete={() => {}}
        onLeave={() => {}}
        onAvatarChange={() => {}}
        onAvatarError={() => {}}
      />,
    );
  }

  it("is a named pencil with the 44px phone target for someone who can rename", () => {
    const html = renderHeader("owner");
    const tag = html.match(/<button[^>]*aria-label="Rename team"[^>]*>/)?.[0];
    expect(tag).toBeDefined();
    expect(tag).toContain("h-11 w-11");
    expect(tag).toContain("sm:h-auto sm:w-auto sm:p-1.5");
  });

  it("renders no name field in place, and no rename dialog until it is pressed", () => {
    const html = renderHeader("owner");
    // The picture picker keeps its own (file) input; the name has none.
    expect(html).not.toContain("rename-team-name");
    expect(html).not.toContain('aria-label="Team name"');
    expect(html).not.toContain("Save team name");
    expect(html).toContain("Platform Security");
  });

  it("hides the trigger from a role that cannot manage the team", () => {
    expect(renderHeader("viewer")).not.toContain('aria-label="Rename team"');
    expect(renderHeader("member")).not.toContain('aria-label="Rename team"');
  });

  it("offers Invite to a manager, who holds manage_members", () => {
    expect(renderHeader("manager")).toContain('aria-label="Invite people"');
    expect(renderHeader("operator")).not.toContain(
      'aria-label="Invite people"',
    );
  });
});

describe("invite someone", () => {
  function renderInvite(currentRole: string, onInvite = vi.fn()) {
    const onClose = vi.fn();
    const html = renderToStaticMarkup(
      <TeamInviteDialog
        currentRole={currentRole}
        onInvite={onInvite}
        onClose={onClose}
      />,
    );
    return { html, onInvite, onClose };
  }

  it("offers a manager only the roles a manager may grant", () => {
    expect(assignableInviteRoles("manager")).toEqual(["viewer", "manager"]);
    const { html } = renderInvite("manager");
    expect(html).toContain('value="viewer"');
    expect(html).toContain('value="manager"');
    // The inline form listed these and the API refused them with a 403.
    expect(html).not.toContain('value="admin"');
    expect(html).not.toContain('value="member"');
    expect(html).not.toContain('value="operator"');
    expect(html).not.toContain('value="owner"');
  });

  it("offers an owner every role except owner, least privileged first", () => {
    expect(assignableInviteRoles("owner")).toEqual([
      "viewer",
      "member",
      "operator",
      "manager",
      "admin",
    ]);
    expect(assignableInviteRoles("member")).toEqual(["viewer", "member"]);
  });

  it("starts empty, on the least privileged role, with the ability text under the select", () => {
    const { html } = renderInvite("manager");
    expect(html).toContain('for="invite-email"');
    expect(html).toContain('type="email"');
    expect(html).toContain('for="invite-role"');
    expect(html).toContain(esc(ROLE_ABILITIES.viewer));
    expect(defaultInviteRole(assignableInviteRoles("manager"))).toBe("viewer");
    const props = lastDialog();
    expect(props.title).toBe("Invite someone");
    expect(props.saveLabel).toBe("Send invite");
    expect(props.canSave).toBe(false);
    expect(props.dirty).toBe(false);
  });

  it("shows the ability text of the chosen role", () => {
    seeds.push("", "manager");
    const { html } = renderInvite("manager");
    expect(html).toContain(esc(ROLE_ABILITIES.manager));
  });

  it("sends the address and role that were chosen", async () => {
    seeds.push("  new@example.com ", "manager");
    const { onInvite } = renderInvite("manager");
    const props = lastDialog();
    expect(props.canSave).toBe(true);

    const { result, closes } = await submit(props);
    expect(onInvite).toHaveBeenCalledWith("new@example.com", "manager");
    expect(result).toEqual({ kind: "saved" });
    expect(closes).toHaveLength(1);
  });

  it("builds the request body from the team, the trimmed address and the role", () => {
    expect(inviteRequestBody(7, " new@example.com ", "viewer")).toEqual({
      teamId: 7,
      email: "new@example.com",
      role: "viewer",
    });
  });

  it("keeps the dialog open with the reason when the invite is refused", async () => {
    seeds.push("full@example.com", "viewer");
    const onInvite = vi
      .fn()
      .mockRejectedValue(new Error("This team is at its member limit."));
    renderInvite("manager", onInvite);

    const { result, errors, closes } = await submit(lastDialog());
    expect(result).toEqual({
      kind: "failed",
      message: "This team is at its member limit.",
    });
    expect(errors).toContain("This team is at its member limit.");
    expect(closes).toHaveLength(0);
  });

  it("will not send without an address", async () => {
    seeds.push("   ", "viewer");
    const { onInvite } = renderInvite("owner");
    expect(lastDialog().canSave).toBe(false);
    const { result } = await submit(lastDialog());
    expect(result).toBeNull();
    expect(onInvite).not.toHaveBeenCalled();
  });

  it("closes on Cancel and Escape without sending", () => {
    seeds.push("typed@example.com", "viewer");
    const { onInvite, onClose } = renderInvite("owner");
    const props = lastDialog();
    expect(props.dirty).toBe(true);
    props.onOpenChange(false);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onInvite).not.toHaveBeenCalled();
  });

  it("renders the copy-once link card after a successful send", () => {
    const html = renderToStaticMarkup(
      <TeamInviteLinkCard
        token="tok123"
        email="new@example.com"
        copied={false}
        onCopy={() => {}}
        onClose={() => {}}
      />,
    );
    expect(html).toContain("Invite sent to new@example.com");
    expect(html).toContain("This link works once");
    expect(html).toContain("/teams/join?token=tok123");
    expect(html).toContain("Copy");
    const dismiss = html.match(
      /<button[^>]*aria-label="Dismiss the invite link"[^>]*>/,
    )?.[0];
    expect(dismiss).toContain("h-11 w-11 ");
    expect(dismiss).toContain("sm:h-9 sm:w-9");
  });

  it("says Copied once the link has been copied", () => {
    const html = renderToStaticMarkup(
      <TeamInviteLinkCard
        token="tok123"
        email="new@example.com"
        copied
        onCopy={() => {}}
        onClose={() => {}}
      />,
    );
    expect(html).toContain("Copied");
  });
});

describe("change a member's role", () => {
  const assignable = ["viewer", "manager"];

  function renderRole(
    onChangeRole: (
      userId: number,
      role: string,
    ) => void | Promise<void> = vi.fn(),
    onClose = vi.fn(),
  ) {
    const html = renderToStaticMarkup(
      <ChangeRoleDialog
        member={sam}
        assignableRoles={assignable}
        onChangeRole={onChangeRole}
        onClose={onClose}
      />,
    );
    return { html, onChangeRole, onClose };
  }

  it("lists only the assignable roles as radios, each with its ability text, current one checked", () => {
    const { html } = renderRole();
    expect(html.match(/type="radio"/g)).toHaveLength(2);
    expect(html).toContain('value="viewer"');
    expect(html).toContain('value="manager"');
    expect(html).not.toContain('value="admin"');
    expect(html).not.toContain('value="owner"');
    expect(html).toContain(esc(ROLE_ABILITIES.viewer));
    expect(html).toContain(esc(ROLE_ABILITIES.manager));
    expect(html).toMatch(
      /value="manager"[^>]*checked|checked[^>]*value="manager"/,
    );
    expect(html).not.toMatch(
      /value="viewer"[^>]*checked|checked[^>]*value="viewer"/,
    );
  });

  it("disables Save on the current role", () => {
    renderRole();
    const props = lastDialog();
    expect(props.title).toBe("Change role");
    expect(props.saveLabel).toBe("Change role");
    expect(props.canSave).toBe(false);
    expect(props.dirty).toBe(false);
    expect(canSaveRoleChange("manager", "manager", assignable)).toBe(false);
  });

  it("allows Save only for a different role that is on offer", () => {
    expect(canSaveRoleChange("manager", "viewer", assignable)).toBe(true);
    expect(canSaveRoleChange("manager", "admin", assignable)).toBe(false);
  });

  it("names the person and the new role in the description", () => {
    expect(roleChangeDescription("Sam Rivera", "manager", "viewer")).toBe(
      "Sam Rivera becomes viewer. That changes what they can do with this team's scans straight away.",
    );
    seeds.push("viewer");
    renderRole();
    expect(lastDialog().description).toBe(
      "Sam Rivera becomes viewer. That changes what they can do with this team's scans straight away.",
    );
  });

  it("calls onChangeRole with the member and the picked role", async () => {
    seeds.push("viewer");
    const { onChangeRole } = renderRole();
    const props = lastDialog();
    expect(props.canSave).toBe(true);
    expect(props.dirty).toBe(true);

    const { result, closes } = await submit(props);
    expect(onChangeRole).toHaveBeenCalledWith(42, "viewer");
    expect(result).toEqual({ kind: "saved" });
    expect(closes).toHaveLength(1);
  });

  it("keeps the dialog open with the reason when the change is refused", async () => {
    seeds.push("viewer");
    const onChangeRole = vi
      .fn()
      .mockRejectedValue(new Error("You can't change your own role."));
    renderRole(onChangeRole);

    const { result, errors, closes } = await submit(lastDialog());
    expect(result).toEqual({
      kind: "failed",
      message: "You can't change your own role.",
    });
    expect(errors).toContain("You can't change your own role.");
    expect(closes).toHaveLength(0);
  });

  it("closes on Cancel and Escape without changing anything", () => {
    seeds.push("viewer");
    const { onChangeRole, onClose } = renderRole();
    lastDialog().onOpenChange(false);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onChangeRole).not.toHaveBeenCalled();
    expect(sam.role).toBe("manager");
  });
});

describe("the member row's Actions trigger", () => {
  function renderList(currentRole: string) {
    return renderToStaticMarkup(
      <TeamMembersList
        members={[sam]}
        invites={[]}
        loading={false}
        currentRole={currentRole}
        currentUserId={1}
        onViewScans={() => {}}
        onRemoveMember={() => {}}
        onCancelInvite={() => {}}
        onChangeRole={() => {}}
      />,
    );
  }

  it("keeps the 44px phone target and a named trigger", () => {
    const tag = renderList("owner").match(
      /<button[^>]*aria-label="Actions for Sam Rivera"[^>]*>/,
    )?.[0];
    expect(tag).toBeDefined();
    expect(tag).toContain("h-11 w-11 sm:h-8 sm:w-8");
  });

  it("mounts no role dialog until Change role... is chosen", () => {
    renderList("owner");
    expect(shown).toHaveLength(0);
  });
});

describe("the Change role... menu item", () => {
  // The menu renders in a portal and opens on a pointer event, neither of
  // which a node render reaches, so the conditions are read from the source.
  const src = fs.readFileSync(
    path.resolve(__dirname, "../../../components/teams/team-members-list.tsx"),
    "utf8",
  );

  it("is one item under the same visibility conditions the submenu had", () => {
    const item = src.slice(src.indexOf("canManage &&"));
    for (const condition of [
      "canManage &&",
      "m.role !== TEAM_ROLES.OWNER &&",
      "onChangeRole &&",
      "m.user_id !== currentUserId &&",
      "canAssignTeamRole(currentRole, m.role) &&",
      "assignableRoles.length > 0 &&",
    ]) {
      expect(item).toContain(condition);
    }
    expect(src).toContain("Change role...");
    expect(src).not.toContain("DropdownMenuSub");
    expect(src).not.toContain("DropdownMenuRadio");
  });

  it("opens the dialog on the next frame, after the menu returned focus", () => {
    expect(src).toMatch(
      /onSelect=\{\(\) =>\s*requestAnimationFrame\(\(\) => setRoleTarget\(m\)\)/,
    );
  });
});
