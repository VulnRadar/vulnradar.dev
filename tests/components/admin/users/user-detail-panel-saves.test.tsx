/**
 * What the user detail panel sends when an admin edits someone's account.
 *
 * The panel used to stage every edit (name, email, plan, role, badges) into
 * one buffer behind a floating save bar. Its "notify the user" choice lived
 * in a piece of state that outlived the save it was made for: unticking it on
 * a badge save did not apply to that save (the handler read the value from
 * before the click), and it then applied to the NEXT save, so an email change
 * made afterwards through the password prompt went out with notifyUser:false
 * and the name or plan changed with it was never announced. Each edit is now
 * its own dialog that says for itself whether the user is told, and account
 * changes always are.
 *
 * There is no DOM here, so the panel and its dialogs are called as functions
 * (see _hook-harness.ts) and their handlers are driven directly.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("react", async (importOriginal) => {
  const { mockReact } = await import("./_hook-harness");
  return mockReact(await importOriginal<typeof import("react")>());
});

const { harness, find, findAll, textOf, labelled, ofType } =
  await import("./_hook-harness");
const { UserDetailPanel } =
  await import("@/components/admin/users/user-detail-panel");
const dialogs = await import("@/components/admin/users/user-edit-dialogs");
const { EditDialog, KEEP_OPEN } =
  await import("@/components/shared/edit-dialog");
const { editCloseDecision, runEditSubmit } =
  await import("@/components/shared/edit-dialog-outcome");
const { AdminPasswordConfirmDialog, AdminMobileTocTrigger } =
  await import("@/components/admin/shared");
const { Button } = await import("@/components/ui/button");

type PanelProps = Parameters<typeof UserDetailPanel>[0];
type Call = [number, string, Record<string, unknown>, unknown?];

const BEE = {
  id: 3,
  name: "bee",
  display_name: "Bee",
  description: null,
  icon: null,
  color: "#336699",
  priority: 0,
  is_limited: false,
};
const OWL = { ...BEE, id: 4, name: "owl", display_name: "Owl" };

function detail(user: Record<string, unknown> = {}, extra = {}) {
  return {
    user: {
      id: 7,
      email: "ada@example.com",
      name: "Ada",
      role: "user",
      plan: "free",
      gifted_plan: null,
      gift_end_date: null,
      created_at: "2026-01-01T00:00:00Z",
      ...user,
    },
    recentScans: [],
    apiKeys: [],
    webhooks: [],
    schedules: [],
    activeSessions: [],
    badges: [{ ...OWL, awarded_at: "2026-01-02T00:00:00Z" }],
    notes: [
      {
        id: 11,
        note: "first line\nsecond line",
        created_at: "2026-01-03T00:00:00Z",
        admin_id: 1,
        admin_email: "staff@example.com",
        admin_name: "Staff",
        admin_avatar_url: null,
      },
    ],
    discordConnection: null,
    githubRepoConnection: null,
    usage: null,
    credits: null,
    ...extra,
  };
}

function setup(
  opts: {
    callerRole?: string;
    user?: Record<string, unknown>;
    result?: (action: string) => { ok: boolean; error?: string };
  } = {},
) {
  const onAction = vi.fn(async (_id: number, action: string) => ({
    ...(opts.result?.(action) ?? { ok: true }),
    change: { field: action, oldValue: "before", newValue: "after" },
  }));
  const onBadgesChanged = vi.fn();
  const props = {
    detail: detail(opts.user),
    detailLoading: false,
    actionLoading: null,
    onClose: () => {},
    onAction,
    callerRole: opts.callerRole ?? "super_admin",
    allBadges: [BEE, OWL],
    onBadgesChanged,
  } as unknown as PanelProps;
  const panel = harness(UserDetailPanel);
  const render = () => panel.render(props);
  const calls = () => onAction.mock.calls as unknown as Call[];
  return { props, render, calls, onAction, onBadgesChanged };
}

function click(tree: unknown, match: Parameters<typeof find>[1]) {
  (find(tree, match).props.onClick as () => void)();
}

const buttonText = (text: string) => (el: { type: unknown; props: object }) =>
  el.type === Button && textOf(el as never).trim() === text;

/** Open a panel dialog and hand back a driver for it. */
function open<P>(
  panelRender: () => unknown,
  trigger: Parameters<typeof find>[1],
  Dialog: (props: P) => unknown,
) {
  click(panelRender(), trigger);
  const el = find(panelRender(), ofType(Dialog));
  const h = harness(Dialog);
  const props = el.props as P;
  return { props, render: () => h.render(props) };
}

function editDialog(tree: unknown) {
  return find(tree, ofType(EditDialog)).props as {
    onSave: () => unknown;
    onOpenChange: (open: boolean) => void;
    canSave: boolean;
    dirty: boolean;
  };
}

describe("account changes always tell the user", () => {
  it("an unticked box on a badge save neither emails that save nor carries into the next one", async () => {
    const { render, calls } = setup();

    const badges = open(
      render,
      buttonText("Edit badges"),
      dialogs.EditBadgesDialog,
    );
    let tree = badges.render();
    (
      find(tree, (el) => el.props.label === "Award Bee").props
        .onToggle as () => void
    )();
    tree = badges.render();
    (
      find(tree, (el) => "checked" in el.props && "onChange" in el.props).props
        .onChange as (v: boolean) => void
    )(false);
    tree = badges.render();
    expect(await editDialog(tree).onSave()).toEqual({ ok: true });
    badges.props.onClose();

    expect(calls().map((c) => c[1])).toEqual(["award_badge"]);

    const account = open(
      render,
      labelled("Edit account"),
      dialogs.EditAccountDialog,
    );
    tree = account.render();
    (
      find(tree, (el) => el.props.name === "email").props.onChange as (
        e: unknown,
      ) => void
    )({ target: { value: "Grace@Example.com " } });
    tree = account.render();
    expect(editDialog(tree).onSave()).toBe(KEEP_OPEN);
    tree = account.render();
    const pw = find(tree, ofType(AdminPasswordConfirmDialog)).props as {
      open: boolean;
      onConfirm: (p: string) => Promise<{ ok: boolean }>;
    };
    expect(pw.open).toBe(true);
    expect(await pw.onConfirm("hunter2")).toEqual({ ok: true });

    const email = calls().find((c) => c[1] === "update_email")!;
    expect(email[2]).toEqual({
      email: "grace@example.com",
      notifyUser: true,
      currentAdminPassword: "hunter2",
    });
  });

  it("a name and plan change without an email saves straight away and sends one summary email", async () => {
    const { render, calls } = setup();
    const account = open(
      render,
      labelled("Edit account"),
      dialogs.EditAccountDialog,
    );
    let tree = account.render();
    (
      find(tree, (el) => el.props.name === "name").props.onChange as (
        e: unknown,
      ) => void
    )({ target: { value: "  Grace  " } });
    tree = account.render();
    (
      find(tree, (el) => el.props.name === "plan").props.onChange as (
        e: unknown,
      ) => void
    )({ target: { value: "pro_supporter" } });
    tree = account.render();
    expect(await editDialog(tree).onSave()).toEqual({ ok: true });

    expect(calls().map((c) => [c[1], c[2]])).toEqual([
      ["update_name", { name: "Grace", notifyUser: false }],
      ["update_plan", { plan: "pro_supporter", notifyUser: false }],
      [
        "notify_account_changes",
        {
          changes: [
            {
              field: "update_name",
              oldValue: "before",
              newValue: "after",
            },
            {
              field: "update_plan",
              oldValue: "before",
              newValue: "after",
            },
          ],
          notifyUser: true,
        },
      ],
    ]);
  });

  it("a wrong password writes nothing and keeps both dialogs open", async () => {
    const { render, calls } = setup({
      result: (action) =>
        action === "update_email"
          ? { ok: false, error: "Incorrect password" }
          : { ok: true },
    });
    const onClose = vi.fn();
    const account = open(
      render,
      labelled("Edit account"),
      dialogs.EditAccountDialog,
    );
    const props = { ...account.props, onClose };
    const h = harness(dialogs.EditAccountDialog);
    let tree = h.render(props);
    for (const [name, value] of [
      ["name", "Grace"],
      ["email", "grace@example.com"],
    ]) {
      (
        find(tree, (el) => el.props.name === name).props.onChange as (
          e: unknown,
        ) => void
      )({ target: { value } });
      tree = h.render(props);
    }
    editDialog(tree).onSave();
    tree = h.render(props);
    const pw = find(tree, ofType(AdminPasswordConfirmDialog)).props as {
      onConfirm: (p: string) => Promise<{ ok: boolean; error?: string }>;
    };
    expect(await pw.onConfirm("wrong")).toEqual({
      ok: false,
      error: "Incorrect password",
    });
    // The gated write goes first, so its refusal stops the name as well.
    expect(calls().map((c) => c[1])).toEqual(["update_email"]);
    expect(onClose).not.toHaveBeenCalled();
    tree = h.render(props);
    expect(
      (
        find(tree, ofType(AdminPasswordConfirmDialog)).props as {
          open: boolean;
        }
      ).open,
    ).toBe(true);
  });

  it("a change that went through before a later one was refused is still announced", async () => {
    // A plan edit on a live Stripe subscription is refused (409) after the
    // name in the same save has been written. The retry measures against the
    // refetched record, so the name is never sent again: if this save did
    // not announce it, nothing ever would.
    const { render, calls } = setup({
      result: (action) =>
        action === "update_plan"
          ? { ok: false, error: "Change the plan in Stripe" }
          : { ok: true },
    });
    const account = open(
      render,
      labelled("Edit account"),
      dialogs.EditAccountDialog,
    );
    let tree = account.render();
    for (const [name, value] of [
      ["name", "Grace"],
      ["plan", "pro_supporter"],
    ]) {
      (
        find(tree, (el) => el.props.name === name).props.onChange as (
          e: unknown,
        ) => void
      )({ target: { value } });
      tree = account.render();
    }
    expect(await editDialog(tree).onSave()).toEqual({
      ok: false,
      error: "Change the plan in Stripe",
    });
    expect(calls().map((c) => [c[1], c[2]])).toEqual([
      ["update_name", { name: "Grace", notifyUser: false }],
      ["update_plan", { plan: "pro_supporter", notifyUser: false }],
      [
        "notify_account_changes",
        {
          changes: [
            { field: "update_name", oldValue: "before", newValue: "after" },
          ],
          notifyUser: true,
        },
      ],
    ]);
  });

  it("a name edit on a mixed-case address saves without touching the address", async () => {
    const { render, calls } = setup({ user: { email: "Ada@Example.com" } });
    const account = open(
      render,
      labelled("Edit account"),
      dialogs.EditAccountDialog,
    );
    let tree = account.render();
    expect(editDialog(tree).canSave).toBe(false);
    (
      find(tree, (el) => el.props.name === "name").props.onChange as (
        e: unknown,
      ) => void
    )({ target: { value: "Grace" } });
    tree = account.render();
    // No password step: nothing gated is in this save.
    expect(await editDialog(tree).onSave()).toEqual({ ok: true });
    expect(calls().map((c) => c[1])).toEqual([
      "update_name",
      "notify_account_changes",
    ]);
  });

  it("a failed save keeps the dialog open with the server's message", async () => {
    const { render } = setup({
      result: () => ({ ok: false, error: "Name is too long" }),
    });
    const account = open(
      render,
      labelled("Edit account"),
      dialogs.EditAccountDialog,
    );
    let tree = account.render();
    (
      find(tree, (el) => el.props.name === "name").props.onChange as (
        e: unknown,
      ) => void
    )({ target: { value: "Grace" } });
    tree = account.render();
    const close = vi.fn();
    const setError = vi.fn();
    const result = await runEditSubmit({
      onSave: editDialog(tree).onSave as never,
      canSave: true,
      busy: false,
      setBusy: () => {},
      setError,
      close,
    });
    expect(result).toEqual({ kind: "failed", message: "Name is too long" });
    expect(close).not.toHaveBeenCalled();
    expect(setError).toHaveBeenLastCalledWith("Name is too long");
  });

  it("Cancel and Escape close without saving and leave the record as it was", () => {
    const { render, onAction, props } = setup();
    const account = open(
      render,
      labelled("Edit account"),
      dialogs.EditAccountDialog,
    );
    let tree = account.render();
    (
      find(tree, (el) => el.props.name === "name").props.onChange as (
        e: unknown,
      ) => void
    )({ target: { value: "Grace" } });
    tree = account.render();
    const dialog = editDialog(tree);
    expect(dialog.dirty).toBe(true);
    // A dirty dialog asks first; only the confirmed discard reaches this.
    expect(editCloseDecision({ busy: false, dirty: true })).toBe(
      "confirm-discard",
    );
    expect(editCloseDecision({ busy: true, dirty: true })).toBe("blocked");
    dialog.onOpenChange(false);
    expect(onAction).not.toHaveBeenCalled();
    expect(findAll(render(), ofType(dialogs.EditAccountDialog))).toHaveLength(
      0,
    );
    expect(props.detail.user.name).toBe("Ada");
  });

  it("the account trigger reaches the 24px floor and names what it edits", () => {
    const { render } = setup();
    const trigger = find(render(), labelled("Edit account"));
    expect(trigger.props.className).toMatch(/\bh-7\b/);
    expect(textOf(trigger)).toContain("Edit");
  });

  it("without canManageStaff the dialog shows the name only", () => {
    const { render } = setup({ callerRole: "moderator" });
    const account = open(
      render,
      labelled("Edit account"),
      dialogs.EditAccountDialog,
    );
    expect(account.props.canEditEmailAndPlan).toBe(false);
    const tree = account.render();
    expect(findAll(tree, (el) => el.props.name === "name")).toHaveLength(1);
    expect(findAll(tree, (el) => el.props.name === "email")).toHaveLength(0);
    expect(findAll(tree, (el) => el.props.name === "plan")).toHaveLength(0);
  });

  it("a dialog opened for one user is gone when the panel moves to another", () => {
    const { render, props } = setup();
    click(render(), labelled("Edit account"));
    expect(findAll(render(), ofType(dialogs.EditAccountDialog))).toHaveLength(
      1,
    );
    (props as unknown as { detail: ReturnType<typeof detail> }).detail = detail(
      {
        id: 8,
        email: "bob@example.com",
        name: "Bob",
      },
    );
    expect(findAll(render(), ofType(dialogs.EditAccountDialog))).toHaveLength(
      0,
    );
  });
});

describe("staff role", () => {
  it("always goes through the password step, with the notify choice the admin made", async () => {
    const { render, calls } = setup();
    const role = open(
      render,
      buttonText("Change role"),
      dialogs.ChangeStaffRoleDialog,
    );
    let tree = role.render();
    (
      find(tree, (el) => el.props.name === "role").props.onChange as (
        e: unknown,
      ) => void
    )({ target: { value: "moderator" } });
    tree = role.render();
    expect(editDialog(tree).canSave).toBe(true);
    expect(editDialog(tree).onSave()).toBe(KEEP_OPEN);
    expect(calls()).toHaveLength(0);
    tree = role.render();
    const pw = find(tree, ofType(AdminPasswordConfirmDialog)).props as {
      open: boolean;
      onConfirm: (p: string) => Promise<{ ok: boolean }>;
    };
    expect(pw.open).toBe(true);
    await pw.onConfirm("hunter2");
    expect(calls().map((c) => [c[1], c[2]])).toEqual([
      [
        "set_role",
        {
          role: "moderator",
          notifyUser: false,
          currentAdminPassword: "hunter2",
        },
      ],
      [
        "notify_account_changes",
        {
          changes: [
            { field: "set_role", oldValue: "before", newValue: "after" },
          ],
          notifyUser: true,
        },
      ],
    ]);
  });

  it("an unticked box sends the role change without an email", async () => {
    const { render, calls } = setup();
    const role = open(
      render,
      buttonText("Change role"),
      dialogs.ChangeStaffRoleDialog,
    );
    let tree = role.render();
    (
      find(tree, (el) => el.props.name === "role").props.onChange as (
        e: unknown,
      ) => void
    )({ target: { value: "support" } });
    tree = role.render();
    (
      find(tree, (el) => "checked" in el.props && "onChange" in el.props).props
        .onChange as (v: boolean) => void
    )(false);
    tree = role.render();
    editDialog(tree).onSave();
    tree = role.render();
    await (
      find(tree, ofType(AdminPasswordConfirmDialog)).props as {
        onConfirm: (p: string) => Promise<unknown>;
      }
    ).onConfirm("pw");
    expect(calls().map((c) => c[1])).toEqual(["set_role"]);
  });

  it("the super admin's role cannot be opened for editing", () => {
    const { render } = setup({ user: { role: "super_admin" } });
    const tree = render();
    const trigger = find(tree, buttonText("Change role"));
    expect(trigger.props.disabled).toBe(true);
    expect(textOf(tree)).toContain("The super admin's role can't be changed.");
  });

  it("never offers super admin to anyone who is not one", () => {
    for (const role of [
      "user",
      "support",
      "billing",
      "moderator",
      "admin",
      null,
    ]) {
      expect(dialogs.staffRoleOptions(role)).not.toContain("super_admin");
    }
    expect(dialogs.staffRoleOptions("super_admin")).toContain("super_admin");
  });
});

describe("badges", () => {
  it("saves exactly the toggled awards and revokes", async () => {
    const { render, calls, onBadgesChanged } = setup();
    const badges = open(
      render,
      buttonText("Edit badges"),
      dialogs.EditBadgesDialog,
    );
    let tree = badges.render();
    (
      find(tree, (el) => el.props.label === "Award Bee").props
        .onToggle as () => void
    )();
    tree = badges.render();
    (
      find(tree, (el) => el.props.label === "Remove badge Owl").props
        .onToggle as () => void
    )();
    tree = badges.render();
    expect(
      findAll(tree, (el) => el.props.label === "Queued to remove Owl"),
    ).toHaveLength(1);
    expect(editDialog(tree).dirty).toBe(true);
    await editDialog(tree).onSave();

    const sent = calls().map((c) => [c[1], c[2]]);
    expect(sent).toEqual([
      ["award_badge", { badgeId: "3", notifyUser: false }],
      ["revoke_badge", { badgeId: "4", notifyUser: false }],
      [
        "notify_account_changes",
        {
          changes: [
            { field: "award_badge", oldValue: "before", newValue: "after" },
            { field: "revoke_badge", oldValue: "before", newValue: "after" },
          ],
          notifyUser: true,
        },
      ],
    ]);
    // One summary toast for the batch, the second PATCH stays quiet.
    expect(calls()[0][3]).toEqual({
      toast: "Badges updated: 1 awarded, 1 removed.",
    });
    expect(calls()[1][3]).toEqual({ toast: false });
    expect(onBadgesChanged).toHaveBeenCalledWith([3], [4]);
  });

  it("a badge the server refused is reported and not shown as awarded", async () => {
    const { render, onBadgesChanged } = setup({
      result: (action) =>
        action === "award_badge"
          ? { ok: false, error: "Badge not found" }
          : { ok: true },
    });
    const badges = open(
      render,
      buttonText("Edit badges"),
      dialogs.EditBadgesDialog,
    );
    let tree = badges.render();
    (
      find(tree, (el) => el.props.label === "Award Bee").props
        .onToggle as () => void
    )();
    tree = badges.render();
    expect(await editDialog(tree).onSave()).toEqual({
      ok: false,
      error: "Badge not found",
    });
    expect(onBadgesChanged).not.toHaveBeenCalled();
  });

  it("an awarded badge can still be removed when the badge list failed to load", () => {
    // The dialog is now the only way to remove one. The old chips were on
    // the card whether or not the catalogue had loaded.
    const { render, props } = setup();
    (props as unknown as { allBadges: unknown[] }).allBadges = [];
    expect(findAll(render(), buttonText("Edit badges"))).toHaveLength(1);
  });

  it("the card keeps Create Badge and Manage Badges and drops the old picker", () => {
    const { render } = setup();
    const tree = render();
    expect(findAll(tree, buttonText("Create Badge"))).toHaveLength(1);
    expect(findAll(tree, buttonText("Manage Badges"))).toHaveLength(1);
    expect(findAll(tree, buttonText("Award Badge"))).toHaveLength(0);
    expect(findAll(tree, labelled("Remove badge Owl"))).toHaveLength(0);
  });
});

describe("admin notes", () => {
  it("edits in a dialog and sends the trimmed text", async () => {
    const { render, calls } = setup();
    const note = open(render, labelled("Edit note"), dialogs.EditNoteDialog);
    expect(note.props.note).toEqual({
      id: 11,
      text: "first line\nsecond line",
    });
    let tree = note.render();
    (
      find(tree, (el) => el.props.name === "note").props.onChange as (
        e: unknown,
      ) => void
    )({ target: { value: "  first line\nthird line \n" } });
    tree = note.render();
    expect(await editDialog(tree).onSave()).toEqual({
      ok: true,
      change: { field: "edit_note", oldValue: "before", newValue: "after" },
    });
    expect(calls().map((c) => [c[1], c[2]])).toEqual([
      ["edit_note", { noteId: 11, note: "first line\nthird line" }],
    ]);
  });

  it("a refused edit keeps the dialog open", async () => {
    const { render } = setup({
      result: () => ({ ok: false, error: "Forbidden" }),
    });
    const note = open(render, labelled("Edit note"), dialogs.EditNoteDialog);
    let tree = note.render();
    (
      find(tree, (el) => el.props.name === "note").props.onChange as (
        e: unknown,
      ) => void
    )({ target: { value: "changed" } });
    tree = note.render();
    const close = vi.fn();
    const result = await runEditSubmit({
      onSave: editDialog(tree).onSave as never,
      canSave: editDialog(tree).canSave,
      busy: false,
      setBusy: () => {},
      setError: () => {},
      close,
    });
    expect(result).toEqual({ kind: "failed", message: "Forbidden" });
    expect(close).not.toHaveBeenCalled();
  });

  it("the pencil keeps its touch size and there is no inline editor", () => {
    const { render } = setup();
    const tree = render();
    const pencil = find(tree, labelled("Edit note"));
    expect(pencil.props.className).toMatch(/\bh-11 w-11\b/);
    expect(pencil.props.className).toMatch(/\bsm:h-7 sm:w-7\b/);
    click(tree, labelled("Edit note"));
    expect(findAll(render(), labelled("Edit note text"))).toHaveLength(0);
  });
});

describe("the floating save bar is gone", () => {
  it("nothing in the panel stages an edit for later", () => {
    const { render } = setup();
    const tree = render();
    expect(findAll(tree, buttonText("Save Changes"))).toHaveLength(0);
    expect(findAll(tree, buttonText("Discard"))).toHaveLength(0);
    // The jump-list trigger no longer has a save bar to sit above.
    const trigger = find(tree, ofType(AdminMobileTocTrigger));
    expect("raised" in trigger.props).toBe(false);
  });
});
