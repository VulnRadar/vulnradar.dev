/**
 * Transfer ownership, from the owner's menu on a team's page (ux-flows-7,
 * owner decision D7).
 *
 * Runs under node with no DOM, the same way team-edit-dialogs.test.tsx does:
 * renderToStaticMarkup with the Dialog and DropdownMenu primitives passed
 * through (both render into portals or only while open, which a static render
 * leaves empty), EditDialog wrapped to record the props it is given, and
 * useState seeded for the first hook a render reaches, which is how a test
 * "picks" a member without firing an onChange.
 */
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

// The menu renders its items only while open; passed through, a static render
// shows exactly which items each role would be offered.
vi.mock("@/components/ui/dropdown-menu", () => {
  const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
  const Item = ({ children }: { children?: ReactNode }) => (
    <div role="menuitem">{children}</div>
  );
  return {
    DropdownMenu: Pass,
    DropdownMenuContent: Pass,
    DropdownMenuItem: Item,
    DropdownMenuTrigger: Pass,
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

const { runEditSubmit } =
  await import("@/components/shared/edit-dialog-outcome");
const { TeamDetailHeader } =
  await import("@/components/teams/team-detail-header");
const { TransferOwnershipDialog, transferCandidates, transferDescription } =
  await import("@/components/teams/transfer-ownership-dialog");

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

const members = [
  {
    user_id: 1,
    role: "owner",
    joined_at: "2026-01-01T00:00:00Z",
    name: "Owner",
    email: "owner@example.com",
  },
  {
    user_id: 42,
    role: "admin",
    joined_at: "2026-02-01T00:00:00Z",
    name: "Sam Rivera",
    email: "sam@example.com",
  },
  {
    user_id: 43,
    role: "viewer",
    joined_at: "2026-03-01T00:00:00Z",
    name: "",
    email: "lee@example.com",
  },
] as Member[];

beforeEach(() => {
  seeds.length = 0;
  shown.length = 0;
});

function lastDialog(): DialogProps {
  const props = shown[shown.length - 1];
  expect(props, "no EditDialog was rendered").toBeDefined();
  return props;
}

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

describe("the header's Transfer ownership item", () => {
  function renderHeader(currentRole: string, wired = true) {
    return renderToStaticMarkup(
      <TeamDetailHeader
        team={team}
        currentRole={currentRole}
        memberCount={members.length}
        members={members}
        onBack={() => {}}
        onRename={async () => {}}
        onInvite={() => {}}
        onDelete={() => {}}
        onLeave={() => {}}
        onAvatarChange={() => {}}
        onAvatarError={() => {}}
        onTransferOwnership={wired ? async () => {} : undefined}
      />,
    );
  }

  it("is offered to the owner, beside Delete team", () => {
    const html = renderHeader("owner");
    expect(html).toContain("Transfer ownership");
    expect(html).toContain("Delete team");
  });

  it.each(["admin", "manager", "operator", "member", "viewer"])(
    "is not offered to a %s, who gets Leave team instead",
    (role) => {
      const html = renderHeader(role);
      expect(html).not.toContain("Transfer ownership");
      expect(html).toContain("Leave team");
    },
  );

  it("is not offered when nothing is wired to carry it out", () => {
    expect(renderHeader("owner", false)).not.toContain("Transfer ownership");
  });

  it("opens no dialog until it is chosen", () => {
    renderHeader("owner");
    expect(shown).toHaveLength(0);
  });
});

describe("the transfer dialog", () => {
  function renderDialog(onTransfer = vi.fn()) {
    const html = renderToStaticMarkup(
      <TransferOwnershipDialog
        team={team}
        members={members}
        onTransfer={onTransfer}
        onClose={() => {}}
      />,
    );
    return { html, onTransfer };
  }

  it("lists every member but the owner, by name or by address", () => {
    const { html } = renderDialog();
    expect(transferCandidates(members).map((m) => m.user_id)).toEqual([42, 43]);
    expect(html).toContain("Sam Rivera");
    expect(html).toContain("lee@example.com");
    expect(html).not.toContain('value="1"');
    expect(html.match(/type="radio"/g)).toHaveLength(2);
  });

  it("asks the planned question with a red Transfer ownership button, and nothing picked", () => {
    renderDialog();
    const props = lastDialog();
    expect(props.title).toBe("Transfer ownership of Platform Security?");
    expect(props.saveLabel).toBe("Transfer ownership");
    expect(props.destructive).toBe(true);
    expect(props.canSave).toBe(false);
    expect(props.dirty).toBe(false);
  });

  it("names the picked member in what happens next", () => {
    seeds.push(42);
    renderDialog();
    expect(lastDialog().description).toBe(
      "You become an admin. Only Sam Rivera can transfer it back or delete the team.",
    );
    expect(transferDescription(null)).toBe(
      "You become an admin. Only the new owner can transfer it back or delete the team.",
    );
  });

  it("names a member without a name by their address", () => {
    seeds.push(43);
    renderDialog();
    expect(lastDialog().description).toContain("Only lee@example.com can");
  });

  it("sends the picked member's id and closes once it is done", async () => {
    seeds.push(42);
    const { onTransfer } = renderDialog(vi.fn(async () => {}));
    const props = lastDialog();
    expect(props.canSave).toBe(true);

    const { result, closes } = await submit(props);
    expect(onTransfer).toHaveBeenCalledWith(42);
    expect(result).toEqual({ kind: "saved" });
    expect(closes).toHaveLength(1);
  });

  it("stays open with the server's reason when the transfer is refused", async () => {
    seeds.push(42);
    renderDialog(
      vi.fn(async () => {
        throw new Error("Sam Rivera's plan allows 3 team members.");
      }),
    );

    const { errors, closes } = await submit(lastDialog());
    expect(errors.at(-1)).toBe("Sam Rivera's plan allows 3 team members.");
    expect(closes).toHaveLength(0);
  });

  it("says so when nobody else is on the team, and cannot be saved", () => {
    const html = renderToStaticMarkup(
      <TransferOwnershipDialog
        team={team}
        members={members.slice(0, 1)}
        onTransfer={vi.fn()}
        onClose={() => {}}
      />,
    );
    expect(html).toContain("Nobody else is on this team yet.");
    expect(lastDialog().canSave).toBe(false);
  });
});
