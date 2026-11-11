/**
 * The user detail panel and the accounts the route will refuse.
 *
 * The route refuses an action aimed at a peer, a higher rung, the owner
 * account, or yourself for the destructive ones, and it does so after the
 * password check passes. The panel offered every action anyway, so a
 * moderator opening an admin typed their password into a dialog and was then
 * told no, using up the re-auth budget and teaching reflex password entry.
 *
 * There is no DOM here, so the panel is called as a function (see
 * _hook-harness.ts) and the elements it returns are inspected.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("react", async (importOriginal) => {
  const { mockReact } = await import("./_hook-harness");
  return mockReact(await importOriginal<typeof import("react")>());
});

const { harness, find, findAll, textOf, labelled, ofType } =
  await import("./_hook-harness");
const { UserDetailPanel, GatedActionCard } =
  await import("@/components/admin/users/user-detail-panel");
const { AdminReauthDialog } =
  await import("@/components/admin/shared/admin-reauth-dialog");
const { InlineAlert } = await import("@/components/shared/inline-alert");
const { Button } = await import("@/components/ui/button");
const { Input } = await import("@/components/ui/input");

type PanelProps = Parameters<typeof UserDetailPanel>[0];

function detail(user: Record<string, unknown>) {
  return {
    user: {
      id: 7,
      email: "target@example.com",
      name: "Target",
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
    badges: [],
    notes: [],
    discordConnection: null,
    githubRepoConnection: null,
    usage: null,
    credits: null,
  };
}

function setup(opts: {
  callerRole: string;
  callerId: number;
  target: Record<string, unknown>;
}) {
  const onAction = vi.fn(async () => ({
    ok: true,
    change: { field: "f", oldValue: "a", newValue: "b" },
  }));
  const onRefresh = vi.fn(async () => {});
  const props = {
    detail: detail(opts.target),
    detailLoading: false,
    actionLoading: null,
    onClose: () => {},
    onAction,
    onRefresh,
    callerRole: opts.callerRole,
    callerId: opts.callerId,
    allBadges: [],
    onBadgesChanged: () => {},
  } as unknown as PanelProps;
  const panel = harness(UserDetailPanel);
  return { render: () => panel.render(props), onAction, onRefresh };
}

/** Each card, run through GatedActionCard so its computed props are visible. */
function cards(tree: unknown) {
  return findAll(tree, ofType(GatedActionCard)).map((el) => {
    const card = GatedActionCard(
      el.props as unknown as Parameters<typeof GatedActionCard>[0],
    ) as unknown as { props: { disabled?: boolean; description?: string } };
    return {
      action: el.props.action as string,
      onClick: el.props.onClick as () => void,
      disabled: card.props.disabled === true,
      description: card.props.description,
    };
  });
}

const disabledOf = (tree: unknown, label: string) =>
  find(tree, labelled(label)).props.disabled === true;

const buttonByText = (text: string) => (el: { type: unknown; props: object }) =>
  el.type === Button && textOf(el as never).trim() === text;

const NOTE = "Your role cannot act on this account.";

describe("a moderator viewing an admin", () => {
  const { render } = setup({
    callerRole: "moderator",
    callerId: 20,
    target: { id: 30, role: "admin" },
  });
  const tree = render();

  it("gets no action card they could click", () => {
    const all = cards(tree);
    expect(all.length).toBeGreaterThan(10);
    expect(all.filter((c) => !c.disabled)).toEqual([]);
  });

  it("is told why on the cards the role could otherwise run", () => {
    const logout = cards(tree).find((c) => c.action === "revoke_sessions");
    expect(logout?.description).toBe(NOTE);
  });

  it("cannot open the edit dialogs or the note controls", () => {
    expect(disabledOf(tree, "Edit account")).toBe(true);
    expect(find(tree, buttonByText("Disable account")).props.disabled).toBe(
      true,
    );
    expect(
      find(tree, (el) => el.props["aria-label"] === "New admin note").props
        .disabled,
    ).toBe(true);
    expect(find(tree, ofType(Input)).props.disabled).toBe(true);
  });

  it("says so once, in a note", () => {
    const alerts = findAll(tree, ofType(InlineAlert));
    expect(alerts.map((a) => textOf(a))).toEqual([NOTE]);
  });

  it("never opens the password dialog, even if a click gets through", () => {
    const { render: again } = setup({
      callerRole: "moderator",
      callerId: 20,
      target: { id: 30, role: "admin" },
    });
    const first = again();
    const logoutAll = findAll(first, ofType(GatedActionCard)).find(
      (el) => el.props.action === "force_logout_all",
    )!;
    (logoutAll.props.onClick as () => void)();
    (
      find(first, buttonByText("Disable account")).props.onClick as () => void
    )();
    const dialog = find(again(), ofType(AdminReauthDialog)).props as {
      open: boolean;
    };
    expect(dialog.open).toBe(false);
  });
});

describe("a moderator viewing a regular user", () => {
  const { render } = setup({
    callerRole: "moderator",
    callerId: 20,
    target: { id: 7, role: "user" },
  });
  const tree = render();

  it("keeps the cards their role holds", () => {
    const logout = cards(tree).find((c) => c.action === "revoke_sessions");
    expect(logout?.disabled).toBe(false);
    expect(disabledOf(tree, "Edit account")).toBe(false);
  });

  it("opens the password dialog for a gated action", () => {
    const { render: again } = setup({
      callerRole: "moderator",
      callerId: 20,
      target: { id: 7, role: "user" },
    });
    const first = again();
    const logoutAll = findAll(first, ofType(GatedActionCard)).find(
      (el) => el.props.action === "force_logout_all",
    )!;
    (logoutAll.props.onClick as () => void)();
    const dialog = find(again(), ofType(AdminReauthDialog)).props as {
      open: boolean;
    };
    expect(dialog.open).toBe(true);
  });

  it("has no note about the account", () => {
    expect(findAll(tree, ofType(InlineAlert))).toEqual([]);
  });
});

describe("an admin viewing a peer admin", () => {
  it("is refused every card, like a moderator viewing an admin", () => {
    const { render } = setup({
      callerRole: "admin",
      callerId: 30,
      target: { id: 31, role: "admin" },
    });
    const all = cards(render());
    expect(all.filter((c) => !c.disabled)).toEqual([]);
  });
});

describe("an admin viewing a moderator", () => {
  it("keeps the cards and the role change", () => {
    const { render } = setup({
      callerRole: "admin",
      callerId: 30,
      target: { id: 20, role: "moderator" },
    });
    const tree = render();
    expect(cards(tree).some((c) => !c.disabled)).toBe(true);
    expect(find(tree, buttonByText("Change role")).props.disabled).toBe(false);
  });
});

describe("a super admin viewing an admin", () => {
  it("may act on them", () => {
    const { render } = setup({
      callerRole: "super_admin",
      callerId: 1,
      target: { id: 30, role: "admin" },
    });
    const tree = render();
    expect(
      cards(tree).find((c) => c.action === "revoke_sessions")?.disabled,
    ).toBe(false);
    expect(findAll(tree, ofType(InlineAlert))).toEqual([]);
  });
});

describe("an admin viewing their own account", () => {
  const { render } = setup({
    callerRole: "admin",
    callerId: 30,
    target: { id: 30, role: "admin" },
  });
  const tree = render();

  it("may edit it but not disable, delete or re-role it", () => {
    const all = cards(tree);
    expect(all.find((c) => c.action === "delete")?.disabled).toBe(true);
    expect(all.find((c) => c.action === "delete")?.description).toBe(
      "You cannot do this to your own account.",
    );
    expect(disabledOf(tree, "Edit account")).toBe(false);
    expect(find(tree, buttonByText("Change role")).props.disabled).toBe(true);
    expect(find(tree, buttonByText("Disable account")).props.disabled).toBe(
      true,
    );
  });

  it("still runs the actions the route allows on yourself", () => {
    expect(
      cards(tree).find((c) => c.action === "revoke_sessions")?.disabled,
    ).toBe(false);
  });
});

describe("Force Logout All", () => {
  const forceLogout = (callerRole: string) => {
    const { render } = setup({
      callerRole,
      callerId: callerRole === "admin" ? 30 : 20,
      target: { id: 7, role: "user" },
    });
    const el = findAll(render(), ofType(GatedActionCard)).find(
      (card) => card.props.action === "force_logout_all",
    )!;
    return el.props as { description: string; onClick: () => void };
  };

  it("promises the key revocation only to a role that holds it", () => {
    expect(forceLogout("admin").description).toBe(
      "Ends every session and revokes every API key",
    );
    expect(forceLogout("moderator").description).toBe(
      "Ends every session. Your role cannot revoke API keys, so they stay valid.",
    );
  });

  it("words the confirmation the same way", () => {
    const confirmTextFor = (callerRole: string) => {
      const { render } = setup({
        callerRole,
        callerId: callerRole === "admin" ? 30 : 20,
        target: { id: 7, role: "user" },
      });
      const first = render();
      const card = findAll(first, ofType(GatedActionCard)).find(
        (c) => c.props.action === "force_logout_all",
      )!;
      (card.props.onClick as () => void)();
      return (
        find(render(), ofType(AdminReauthDialog)).props as {
          description: string;
        }
      ).description;
    };
    expect(confirmTextFor("admin")).toContain("revoke all API keys");
    expect(confirmTextFor("moderator")).toContain(
      "API keys are left in place because your role cannot revoke them.",
    );
    expect(confirmTextFor("moderator")).not.toContain("revoke all API keys");
  });
});

describe("a save reloads once", () => {
  it("an account save sends every write quietly and refreshes after the last", async () => {
    const { render, onAction, onRefresh } = setup({
      callerRole: "admin",
      callerId: 30,
      target: { id: 7, role: "user" },
    });
    const tree = render();
    // The account dialog's onSave is what the panel hands it.
    const trigger = find(tree, labelled("Edit account"));
    (trigger.props.onClick as () => void)();
    const dialog = find(
      render(),
      (el) =>
        typeof el.type === "function" &&
        (el.type as { name?: string }).name === "EditAccountDialog",
    ).props as {
      onSave: (
        changes: Record<string, string>,
        opts: { notifyUser: boolean },
      ) => Promise<{ ok: boolean }>;
    };
    const result = await dialog.onSave(
      { name: "Grace", plan: "pro_supporter" },
      { notifyUser: true },
    );
    expect(result.ok).toBe(true);
    const calls = onAction.mock.calls as unknown as unknown[][];
    expect(calls.map((c) => c[1])).toEqual([
      "update_name",
      "update_plan",
      "notify_account_changes",
    ]);
    for (const call of calls) expect(call[3]).toMatchObject({ refetch: false });
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(onRefresh).toHaveBeenCalledWith(7);
  });

  it("a save that wrote nothing does not reload", async () => {
    const { render, onAction, onRefresh } = setup({
      callerRole: "admin",
      callerId: 30,
      target: { id: 7, role: "user" },
    });
    onAction.mockResolvedValue({ ok: false, error: "no" } as never);
    (find(render(), labelled("Edit account")).props.onClick as () => void)();
    const dialog = find(
      render(),
      (el) =>
        typeof el.type === "function" &&
        (el.type as { name?: string }).name === "EditAccountDialog",
    ).props as {
      onSave: (
        c: Record<string, string>,
        o: { notifyUser: boolean },
      ) => Promise<{ ok: boolean }>;
    };
    const result = await dialog.onSave({ name: "Grace" }, { notifyUser: true });
    expect(result.ok).toBe(false);
    expect(onRefresh).not.toHaveBeenCalled();
  });
});
