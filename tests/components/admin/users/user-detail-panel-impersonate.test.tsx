/**
 * Starting an impersonation asks for a second factor as well as the password.
 *
 * The server refuses an impersonation without one whatever ENFORCE_STAFF_2FA
 * says (lib/auth/staff-step-up.ts), so the panel's password-only re-auth
 * dialog would send every attempt into that refusal. Impersonate gets the
 * second-factor dialog instead, the code it collects goes out as totpCode,
 * and a refusal keeps the dialog open with the message, switching to the
 * factor the 403 names.
 *
 * There is no DOM here, so the panel and the dialog are called as functions
 * (see _hook-harness.ts) and their handlers are driven directly.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("react", async (importOriginal) => {
  const { mockReact } = await import("./_hook-harness");
  return mockReact(await importOriginal<typeof import("react")>());
});

let me: Record<string, unknown> = {};
vi.mock("@/components/providers/auth-provider", () => ({
  useAuth: () => ({ me, isLoading: false }),
  clearAuthCache: () => {},
}));

vi.mock("@/lib/hooks/use-client-config", () => ({
  useClientConfig: () => ({ emailConfigured: true, loaded: true }),
}));

const { harness, find, findAll, textOf, ofType } =
  await import("./_hook-harness");
const { UserDetailPanel, GatedActionCard } =
  await import("@/components/admin/users/user-detail-panel");
const { AdminReauthDialog } =
  await import("@/components/admin/shared/admin-reauth-dialog");
const { StaffSecondFactorDialog } =
  await import("@/components/admin/shared/staff-second-factor-dialog");
const { EmailStepUp } = await import("@/components/shared/email-step-up");
const { InlineAlert } = await import("@/components/shared/inline-alert");
const { Button } = await import("@/components/ui/button");
const { Input } = await import("@/components/ui/input");
const { SECOND_FACTOR_MESSAGES } =
  await import("@/lib/auth/staff-second-factor-kind");

type PanelProps = Parameters<typeof UserDetailPanel>[0];
type DialogProps = Parameters<typeof StaffSecondFactorDialog>[0];
type Call = [number, string, Record<string, unknown>, unknown?];

function detail() {
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

function setup(result: { ok: boolean; error?: string } = { ok: true }) {
  const onAction = vi.fn(async () => result);
  const props = {
    detail: detail(),
    detailLoading: false,
    actionLoading: null,
    onClose: () => {},
    onAction,
    callerRole: "admin",
    callerId: 2,
    callerHasPassword: true,
    onRefresh: vi.fn(async () => {}),
    allBadges: [],
    onBadgesChanged: vi.fn(),
  } as unknown as PanelProps;
  const panel = harness(UserDetailPanel);
  const render = () => panel.render(props);
  const calls = () => onAction.mock.calls as unknown as Call[];
  return { render, calls };
}

function queueImpersonate(render: () => unknown) {
  const card = findAll(render(), ofType(GatedActionCard)).find(
    (el) => el.props.action === "impersonate",
  )!;
  (card.props.onClick as () => void)();
}

const confirmButton = (label: string) => (el: { type: unknown }) =>
  el.type === Button && textOf(el as never).includes(label);

beforeEach(() => {
  me = {
    userId: 2,
    role: "admin",
    hasPassword: true,
    totpEnabled: true,
    twoFactorMethod: "app",
  };
});

describe("the impersonate confirmation", () => {
  it("opens the second-factor dialog, not the password-only one", () => {
    const { render } = setup();
    queueImpersonate(render);
    const tree = render();
    const factor = find(tree, ofType(StaffSecondFactorDialog))
      .props as unknown as DialogProps;
    expect(factor.open).toBe(true);
    expect(factor.hasPassword).toBe(true);
    expect(find(tree, ofType(AdminReauthDialog)).props.open).toBe(false);
  });

  it("leaves every other gated action on the password dialog", () => {
    const { render } = setup();
    const card = findAll(render(), ofType(GatedActionCard)).find(
      (el) => el.props.action === "force_logout_all",
    )!;
    (card.props.onClick as () => void)();
    const tree = render();
    expect(find(tree, ofType(AdminReauthDialog)).props.open).toBe(true);
    expect(find(tree, ofType(StaffSecondFactorDialog)).props.open).toBe(false);
  });

  it("sends the password and the authenticator code with the impersonate action", async () => {
    // A started impersonation reloads into the dashboard as the customer.
    const location = { href: "" };
    vi.stubGlobal("window", { location });
    try {
      const { render, calls } = setup();
      queueImpersonate(render);
      const factor = find(render(), ofType(StaffSecondFactorDialog))
        .props as unknown as DialogProps;
      expect(
        await factor.onConfirm({ password: "hunter2", totpCode: "123456" }),
      ).toMatchObject({ ok: true });
      const sent = calls().find((c) => c[1] === "impersonate")!;
      expect(sent[2]).toMatchObject({
        currentAdminPassword: "hunter2",
        totpCode: "123456",
      });
      expect(location.href).toBe("/dashboard");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("hands a refusal back to the dialog, which stays open", async () => {
    const { render } = setup({
      ok: false,
      error: SECOND_FACTOR_MESSAGES.totpWrong,
    });
    queueImpersonate(render);
    const factor = find(render(), ofType(StaffSecondFactorDialog))
      .props as unknown as DialogProps;
    expect(
      await factor.onConfirm({ password: "hunter2", totpCode: "000000" }),
    ).toEqual({ ok: false, error: SECOND_FACTOR_MESSAGES.totpWrong });
    expect(find(render(), ofType(StaffSecondFactorDialog)).props.open).toBe(
      true,
    );
  });
});

describe("StaffSecondFactorDialog", () => {
  function dialog(
    onConfirm: DialogProps["onConfirm"] = async () => ({ ok: true }),
  ) {
    const props: DialogProps = {
      open: true,
      onOpenChange: vi.fn(),
      title: "Impersonate User",
      description: "Sign in as Ada.",
      confirmLabel: "Start impersonating",
      variant: "destructive",
      onConfirm,
    };
    const h = harness(StaffSecondFactorDialog);
    return { props, render: () => h.render(props) };
  }

  function type(tree: unknown, idSuffix: string, value: string) {
    const input = find(
      tree,
      (el) => el.type === Input && String(el.props.id).endsWith(idSuffix),
    );
    (input.props.onChange as (e: unknown) => void)({ target: { value } });
  }

  it("holds Confirm until the password and six digits are in, then sends both", async () => {
    const onConfirm = vi.fn(async () => ({ ok: true }));
    const d = dialog(onConfirm);
    let tree = d.render();
    expect(
      find(tree, confirmButton("Start impersonating")).props.disabled,
    ).toBe(true);
    type(tree, "-password", "hunter2");
    tree = d.render();
    type(tree, "-totp", "12a3456");
    tree = d.render();
    const confirm = find(tree, confirmButton("Start impersonating"));
    expect(confirm.props.disabled).toBe(false);
    await (confirm.props.onClick as () => Promise<void>)();
    expect(onConfirm).toHaveBeenCalledWith({
      password: "hunter2",
      totpCode: "123456",
    });
  });

  it("stays open with the message on a refused code, and clears the code", async () => {
    const d = dialog(async () => ({
      ok: false,
      error: SECOND_FACTOR_MESSAGES.totpWrong,
      secondFactor: "totp",
    }));
    let tree = d.render();
    type(tree, "-password", "hunter2");
    tree = d.render();
    type(tree, "-totp", "000000");
    tree = d.render();
    await (
      find(tree, confirmButton("Start impersonating")).props
        .onClick as () => Promise<void>
    )();
    tree = d.render();
    expect(d.props.onOpenChange).not.toHaveBeenCalled();
    const alerts = findAll(tree, ofType(InlineAlert)).map((el) =>
      textOf(el.props.children),
    );
    expect(alerts).toContain(SECOND_FACTOR_MESSAGES.totpWrong);
    const code = find(
      tree,
      (el) => el.type === Input && String(el.props.id).endsWith("-totp"),
    );
    expect(code.props.value).toBe("");
  });

  it("switches to the factor a refusal names", async () => {
    const d = dialog(async () => ({
      ok: false,
      error: SECOND_FACTOR_MESSAGES.emailMissing,
      secondFactor: "email",
    }));
    let tree = d.render();
    type(tree, "-password", "hunter2");
    tree = d.render();
    type(tree, "-totp", "123456");
    tree = d.render();
    await (
      find(tree, confirmButton("Start impersonating")).props
        .onClick as () => Promise<void>
    )();
    tree = d.render();
    const stepUp = find(tree, ofType(EmailStepUp));
    expect(stepUp.props.mode).toBe("second-factor");
    expect(
      findAll(
        tree,
        (el) => el.type === Input && String(el.props.id).endsWith("-totp"),
      ),
    ).toHaveLength(0);
  });

  it("replaces the form with the refusal when a 403 says two-factor is off", async () => {
    const d = dialog(async () => ({
      ok: false,
      error: SECOND_FACTOR_MESSAGES.none,
      secondFactor: "none",
    }));
    let tree = d.render();
    type(tree, "-password", "hunter2");
    tree = d.render();
    type(tree, "-totp", "123456");
    tree = d.render();
    await (
      find(tree, confirmButton("Start impersonating")).props
        .onClick as () => Promise<void>
    )();
    tree = d.render();
    const alerts = findAll(tree, ofType(InlineAlert));
    // Once, in place of the form, not repeated under it as an error.
    expect(alerts).toHaveLength(1);
    expect(alerts[0].props.tone).toBe("warning");
    expect(textOf(alerts[0].props.children)).toContain(
      SECOND_FACTOR_MESSAGES.none,
    );
    expect(findAll(tree, confirmButton("Start impersonating"))).toHaveLength(0);
    expect(findAll(tree, ofType(Input))).toHaveLength(0);
  });

  it("waits on the mailed code for an email-code account", () => {
    me = { ...me, twoFactorMethod: "email" };
    const d = dialog();
    let tree = d.render();
    type(tree, "-password", "hunter2");
    tree = d.render();
    expect(
      find(tree, confirmButton("Start impersonating")).props.disabled,
    ).toBe(true);
    const stepUp = find(tree, ofType(EmailStepUp));
    expect(stepUp.props.mode).toBe("second-factor");
    (stepUp.props.onReady as () => void)();
    tree = d.render();
    expect(
      find(tree, confirmButton("Start impersonating")).props.disabled,
    ).toBe(false);
  });

  it("asks for a fresh mailed code when the server finds none for this session", async () => {
    me = { ...me, twoFactorMethod: "email" };
    const d = dialog(async () => ({
      ok: false,
      error: SECOND_FACTOR_MESSAGES.emailMissing,
      secondFactor: "email",
    }));
    let tree = d.render();
    type(tree, "-password", "hunter2");
    tree = d.render();
    const before = find(tree, ofType(EmailStepUp)) as unknown as {
      key: unknown;
      props: { onReady: () => void };
    };
    before.props.onReady();
    tree = d.render();
    await (
      find(tree, confirmButton("Start impersonating")).props
        .onClick as () => Promise<void>
    )();
    tree = d.render();
    // Not "Confirmed" over a refusal that says there is no step-up: the
    // mailed code starts again, and Confirm waits on it.
    expect(
      find(tree, confirmButton("Start impersonating")).props.disabled,
    ).toBe(true);
    const after = find(tree, ofType(EmailStepUp)) as unknown as {
      key: unknown;
    };
    expect(after.key).not.toBe(before.key);
    expect(
      findAll(tree, ofType(InlineAlert)).map((el) => textOf(el.props.children)),
    ).toContain(SECOND_FACTOR_MESSAGES.emailMissing);
  });
});

describe("the mailed second factor on a server that turns out not to send mail", () => {
  it("says an authenticator app is needed, not to sign in again, and stays not ready", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: "Sign in again to confirm it is you.",
              emailConfigured: false,
            }),
            { status: 409 },
          ),
      ),
    );
    try {
      const onReady = vi.fn();
      const stepUp = harness(EmailStepUp);
      const render = () =>
        stepUp.render({ mode: "second-factor", onReady }) as {
          props: { phase: string; error: string | null; onSend: () => void };
        };
      render().props.onSend();
      await vi.waitFor(() => expect(render().props.error).not.toBeNull());
      expect(render().props.error).toBe(SECOND_FACTOR_MESSAGES.noMail);
      expect(render().props.phase).toBe("start");
      expect(onReady).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
