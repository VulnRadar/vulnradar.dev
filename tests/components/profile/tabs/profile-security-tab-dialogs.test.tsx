/**
 * The Security tab's forms open in dialogs (components/profile/tabs/
 * profile-security-tab.tsx): change or set the password, generate new backup
 * codes, set up the authenticator app, turn on email codes, turn two-step off.
 *
 * Each of these sends a password, so two things are pinned beyond the dialog
 * grammar. Every password reaches the request body exactly as it was typed:
 * the email-codes form used to trim it, and the server compares what it gets
 * with the stored hash as is, so a password that starts or ends with a space
 * could never turn email codes on and every try still spent a rate-limited
 * attempt. And every flow keeps its own failure inside its own dialog, where
 * the page-wide banner would sit behind the scrim.
 *
 * There is no DOM library in this tier. Markup comes from renderToStaticMarkup
 * with EditDialog stood in for by a pass-through that prints its labels. The
 * state machines are driven by calling a component as a function with React's
 * hooks replaced by a plain store (the pattern of use-focus-on-mount.test.ts),
 * which hands back the element tree, EditDialog's props included, without
 * rendering it.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";

const hooks = vi.hoisted(() => ({
  direct: false,
  states: [] as unknown[],
  index: 0,
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const state = (init: unknown) => {
    const i = hooks.index++;
    if (!(i in hooks.states)) {
      hooks.states[i] = typeof init === "function" ? init() : init;
    }
    const set = (next: unknown) => {
      hooks.states[i] =
        typeof next === "function" ? next(hooks.states[i]) : next;
    };
    return [hooks.states[i], set];
  };
  return {
    ...actual,
    useState: ((init: unknown) =>
      hooks.direct
        ? state(init)
        : actual.useState(init)) as typeof actual.useState,
    useRef: ((init: unknown) =>
      hooks.direct
        ? { current: init }
        : actual.useRef(init)) as typeof actual.useRef,
    useEffect: ((fn: () => void, deps?: unknown[]) =>
      hooks.direct
        ? undefined
        : actual.useEffect(fn, deps)) as typeof actual.useEffect,
    useCallback: ((fn: unknown, deps: unknown[]) =>
      hooks.direct
        ? fn
        : actual.useCallback(
            fn as () => void,
            deps,
          )) as typeof actual.useCallback,
  };
});

interface EditDialogMockProps {
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  saveLabel?: string;
  cancelLabel?: string;
  tier?: string;
  size?: string;
  destructive?: boolean;
  dirty?: boolean;
  canSave?: boolean;
  onSave: () => unknown;
  onOpenChange: (open: boolean) => void;
}

/** What useEditDialogError hands the fields: set by the a11y cases below. */
const dialogError = vi.hoisted(() => ({
  error: null as string | null,
  errorId: "edit-dialog-error" as string | undefined,
}));

/** The client config the tab reads; emailConfigured is absent by default. */
const clientConfig = vi.hoisted(() => ({
  value: {} as Record<string, unknown>,
}));

vi.mock("@/lib/hooks/use-client-config", () => ({
  useClientConfig: () => clientConfig.value,
}));

vi.mock("@/components/shared/edit-dialog", async () => {
  const outcome = await import("@/components/shared/edit-dialog-outcome");
  function EditDialog(props: EditDialogMockProps) {
    return (
      <div
        data-edit-dialog=""
        data-tier={props.tier ?? "shell"}
        data-size={props.size ?? "md"}
        data-destructive={props.destructive ? "true" : "false"}
      >
        <h2>{props.title}</h2>
        {props.description ? <p>{props.description}</p> : null}
        {props.children}
        <button type="button">{props.cancelLabel ?? "Cancel"}</button>
        <button type="submit">{props.saveLabel ?? "Save changes"}</button>
      </div>
    );
  }
  return {
    EditDialog,
    KEEP_OPEN: outcome.KEEP_OPEN,
    useEditDialogError: () => ({ ...dialogError }),
  };
});

vi.mock("@/components/providers/auth-provider", () => ({
  refreshAuthCache: vi.fn(),
  clearAuthCache: vi.fn(),
}));

const { EmailStepUp } = await import("@/components/shared/email-step-up");

const { KEEP_OPEN, editCloseDecision } =
  await import("@/components/shared/edit-dialog-outcome");
const { refreshAuthCache } =
  await import("@/components/providers/auth-provider");
const { API, PASSWORD_MIN_LENGTH } =
  await import("@/lib/config/client-constants");
const tab = await import("@/components/profile/tabs/profile-security-tab");
const {
  ProfileSecurityTab,
  PasswordDialog,
  RegenerateBackupCodesDialog,
  AuthenticatorSetupDialog,
  EnableEmailCodesDialog,
  TurnOffTwoFactorDialog,
  passwordDraftProblem,
  passwordUpdateBody,
  isPasswordDraftDirty,
  savePassword,
  regenerateBackupCodes,
  verifyAuthenticator,
  sendEmailCodesConfirmation,
  enableEmailCodes,
  turnOffTwoFactor,
  turnOffTwoFactorRequest,
} = tab;

const ROOT = path.resolve(__dirname, "../../../..");
const SOURCE = readFileSync(
  path.join(ROOT, "components/profile/tabs/profile-security-tab.tsx"),
  "utf8",
);

/* ── helpers ── */

type El = ReactElement<Record<string, unknown>>;

function* walk(node: unknown): Generator<El> {
  if (Array.isArray(node)) {
    for (const n of node) yield* walk(n);
    return;
  }
  if (!isValidElement(node)) return;
  const el = node as El;
  yield el;
  for (const [key, value] of Object.entries(el.props)) {
    if (key === "children" || isValidElement(value) || Array.isArray(value)) {
      yield* walk(value);
    }
  }
}

function textOf(node: unknown): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement(node)) {
    return textOf((node as El).props.children);
  }
  return "";
}

function find(tree: unknown, test: (el: El) => boolean): El | undefined {
  for (const el of walk(tree)) if (test(el)) return el;
  return undefined;
}

function byText(tree: unknown, text: string): El | undefined {
  return find(
    tree,
    (el) => typeof el.props.onClick === "function" && textOf(el) === text,
  );
}

function byId(tree: unknown, id: string): El {
  const el = find(tree, (e) => e.props.id === id);
  if (!el) throw new Error(`no element with id ${id}`);
  return el;
}

function ofType(tree: unknown, type: unknown): El | undefined {
  return find(tree, (el) => el.type === type);
}

/** Run a component as a function, hooks from the store. */
function direct<P>(component: (props: P) => unknown, props: P): El {
  hooks.direct = true;
  hooks.index = 0;
  try {
    return component(props) as El;
  } finally {
    hooks.direct = false;
  }
}

function dialogProps(el: El): EditDialogMockProps {
  return el.props as unknown as EditDialogMockProps;
}

/** Type into an <Input>: its onChange takes the change event. */
function typeInto(el: El, value: string) {
  (el.props.onChange as (e: { target: { value: string } }) => void)({
    target: { value },
  });
}

/**
 * Type into a PasswordField, or the ReauthField that holds one: both take the
 * string, as onChange and onPasswordChange.
 */
function typeValue(el: El, value: string) {
  const handler = (el.props.onChange ?? el.props.onPasswordChange) as (
    v: string,
  ) => void;
  handler(value);
}

/**
 * Type the way the browser does, through the <input>'s own change handler. A
 * wrapper such as PasswordField (a plain function, no hooks) is expanded
 * first, so a trim written inside it runs here instead of being stepped round
 * by calling the wrapper's string handler directly.
 */
function typeAsBrowser(tree: unknown, id: string, value: string) {
  let el = byId(tree, id);
  while (typeof el.type === "function") {
    el = byId((el.type as (props: unknown) => unknown)(el.props), id);
  }
  typeInto(el, value);
}

interface FetchCall {
  url: string;
  method: string;
  body: unknown;
}

function stubFetch(
  respond: (call: FetchCall) => { ok: boolean; data: unknown } = () => ({
    ok: true,
    data: {},
  }),
) {
  const calls: FetchCall[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const call = {
      url,
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(call);
    const { ok, data } = respond(call);
    return { ok, json: async () => data };
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

function baseProps(over: Record<string, unknown> = {}) {
  return {
    user: {
      userId: 1,
      email: "dev@example.com",
      name: "Dev",
      totpEnabled: false,
      twoFactorMethod: null,
      hasPassword: true,
      ...(over.user as object),
    },
    loading: false,
    error: null,
    success: null,
    setError: vi.fn(),
    setSuccess: vi.fn(),
    onTabChange: vi.fn(),
    pendingChanges: {},
    setPendingChanges: vi.fn(),
    ...over,
  } as unknown as Parameters<typeof ProfileSecurityTab>[0];
}

function tokens(className: unknown): string[] {
  return String(className ?? "")
    .split(/\s+/)
    .filter(Boolean);
}

/** At least 24px tall from the control's own box. */
function clearsTargetFloor(className: unknown): boolean {
  const t = tokens(className);
  const h = t.find((x) => /^h-\d+$/.test(x));
  if (h && Number(h.slice(2)) * 4 >= 24) return true;
  // A text-sm line is 20px; py-1.5 adds 6px a side.
  return t.includes("text-sm") && t.includes("py-1.5");
}

beforeEach(() => {
  hooks.states = [];
  hooks.index = 0;
  vi.mocked(refreshAuthCache).mockClear();
  dialogError.error = null;
  clientConfig.value = {};
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/* ── the security fix ── */

describe("every password on the Security tab is sent exactly as typed", () => {
  it("never trims a password before it is checked or sent", () => {
    // trimStart and trimEnd too: either one alone still changes what the
    // server hashes.
    expect(SOURCE).not.toMatch(/[Pp]assword\w*\.trim\w*\(/);
  });

  // The request helpers (tested below) are only half of it: each dialog's
  // field and its Save sit between the keyboard and the helper, and a trim in
  // either would pass every helper test. So each flow is driven from its own
  // <input> to the request it sends.
  describe("from each dialog's own field to its request", () => {
    const PW = " pw ";
    const long = ` ${"x".repeat(PASSWORD_MIN_LENGTH)} `;

    it("PasswordDialog", async () => {
      const calls = stubFetch();
      const props = { hasPassword: true, onClose: vi.fn(), onSaved: vi.fn() };
      const tree = direct(PasswordDialog, props);
      typeAsBrowser(tree, "sec-current-pw", PW);
      typeAsBrowser(tree, "sec-new-pw", long);
      typeAsBrowser(tree, "sec-confirm-new-pw", long);
      expect(
        await dialogProps(direct(PasswordDialog, props)).onSave(),
      ).toBeUndefined();
      expect(calls.map((c) => c.body)).toEqual([
        { currentPassword: PW, newPassword: long },
      ]);
    });

    it("RegenerateBackupCodesDialog", async () => {
      const calls = stubFetch(() => ({
        ok: true,
        data: { backupCodes: ["c1"] },
      }));
      const props = { onClose: vi.fn(), onIssued: vi.fn() };
      typeAsBrowser(
        direct(RegenerateBackupCodesDialog, props),
        "regen-backup-password",
        PW,
      );
      await dialogProps(direct(RegenerateBackupCodesDialog, props)).onSave();
      expect(calls.map((c) => c.body)).toEqual([{ password: PW }]);
    });

    it("AuthenticatorSetupDialog", async () => {
      const calls = stubFetch(() => ({ ok: true, data: { backupCodes: [] } }));
      const props = {
        setup: { uri: "otpauth://totp/x?secret=A", secret: "A" },
        onClose: vi.fn(),
        onEnabled: vi.fn(),
      };
      await dialogProps(direct(AuthenticatorSetupDialog, props)).onSave();
      const verify = direct(AuthenticatorSetupDialog, props);
      typeAsBrowser(verify, "setup-2fa-code", "123456");
      typeAsBrowser(verify, "setup-2fa-password", PW);
      await dialogProps(direct(AuthenticatorSetupDialog, props)).onSave();
      expect(calls.map((c) => c.body)).toEqual([
        { code: "123456", currentPassword: PW },
      ]);
    });

    it("EnableEmailCodesDialog", async () => {
      const calls = stubFetch();
      const props = { onClose: vi.fn(), onEnabled: vi.fn() };
      typeAsBrowser(
        direct(EnableEmailCodesDialog, props),
        "enable-email-2fa-password",
        PW,
      );
      await dialogProps(direct(EnableEmailCodesDialog, props)).onSave();
      expect(calls.map((c) => c.body)).toEqual([{ password: PW }]);
    });

    it.each(["app", "email"] as const)(
      "TurnOffTwoFactorDialog (%s)",
      async (method) => {
        const calls = stubFetch();
        const props = { method, onClose: vi.fn(), onTurnedOff: vi.fn() };
        typeAsBrowser(
          direct(TurnOffTwoFactorDialog, props),
          `disable-${method}-2fa-password`,
          PW,
        );
        await dialogProps(direct(TurnOffTwoFactorDialog, props)).onSave();
        expect(calls.map((c) => c.body)).toEqual([{ password: PW }]);
      },
    );
  });

  it("keeps ' pw ' unchanged in every request body", async () => {
    const calls = stubFetch(() => ({ ok: true, data: { backupCodes: [] } }));
    const long = ` ${"x".repeat(PASSWORD_MIN_LENGTH)} `;
    await savePassword({ current: " pw ", next: long, confirm: long }, true);
    await regenerateBackupCodes(" pw ");
    await verifyAuthenticator("123456", " pw ");
    await sendEmailCodesConfirmation(" pw ");
    await enableEmailCodes(" pw ", "123456");
    await turnOffTwoFactor("app", " pw ");
    await turnOffTwoFactor("email", " pw ");
    expect(calls.map((c) => c.body)).toEqual([
      { currentPassword: " pw ", newPassword: long },
      { password: " pw " },
      { code: "123456", currentPassword: " pw " },
      { password: " pw " },
      { password: " pw ", code: "123456" },
      { password: " pw " },
      { password: " pw " },
    ]);
  });

  it("lets a password that is only spaces be sent to the server to judge", async () => {
    // The old email-codes Save stayed disabled for it (`!password.trim()`),
    // so the account whose password it is could never confirm with it.
    const cases: [(props: never) => unknown, object, string][] = [
      [
        EnableEmailCodesDialog,
        { onClose: vi.fn(), onEnabled: vi.fn() },
        "enable-email-2fa-password",
      ],
      [
        RegenerateBackupCodesDialog,
        { onClose: vi.fn(), onIssued: vi.fn() },
        "regen-backup-password",
      ],
      [
        TurnOffTwoFactorDialog,
        { method: "app", onClose: vi.fn(), onTurnedOff: vi.fn() },
        "disable-app-2fa-password",
      ],
      [
        TurnOffTwoFactorDialog,
        { method: "email", onClose: vi.fn(), onTurnedOff: vi.fn() },
        "disable-email-2fa-password",
      ],
    ];
    for (const [component, props, id] of cases) {
      hooks.states = [];
      typeAsBrowser(direct(component, props as never), id, "   ");
      expect(dialogProps(direct(component, props as never)).canSave).toBe(true);
    }
    const setupProps = {
      setup: { uri: "otpauth://totp/x?secret=A", secret: "A" },
      onClose: vi.fn(),
      onEnabled: vi.fn(),
    };
    hooks.states = [];
    await dialogProps(direct(AuthenticatorSetupDialog, setupProps)).onSave();
    const verify = direct(AuthenticatorSetupDialog, setupProps);
    typeAsBrowser(verify, "setup-2fa-code", "123456");
    typeAsBrowser(verify, "setup-2fa-password", "   ");
    expect(
      dialogProps(direct(AuthenticatorSetupDialog, setupProps)).canSave,
    ).toBe(true);
  });
});

/* ── password ── */

describe("PasswordDialog", () => {
  const long = "a".repeat(PASSWORD_MIN_LENGTH);

  it("opens from the Password card's button, which clears the target floor", () => {
    hooks.states = [];
    const props = baseProps();
    const tree = direct(ProfileSecurityTab, props);
    const trigger = byText(tree, "Change password");
    expect(trigger).toBeDefined();
    expect(clearsTargetFloor(trigger!.props.className)).toBe(true);
    expect(ofType(tree, PasswordDialog)).toBeUndefined();
    (trigger!.props.onClick as () => void)();
    const opened = direct(ProfileSecurityTab, props);
    expect(ofType(opened, PasswordDialog)).toBeDefined();
  });

  it("names the button for an account with no password", () => {
    const tree = direct(
      ProfileSecurityTab,
      baseProps({ user: { hasPassword: false } }),
    );
    expect(byText(tree, "Set a password")).toBeDefined();
  });

  it("renders the three fields empty, the hint tied to the new one, Cancel and Update password", () => {
    const html = renderToStaticMarkup(
      <PasswordDialog hasPassword onClose={() => {}} onSaved={() => {}} />,
    );
    expect(html).toContain('data-size="sm"');
    expect(html).toMatch(
      /id="sec-current-pw"[^>]*autoComplete="current-password"|autoComplete="current-password"[^>]*id="sec-current-pw"/i,
    );
    expect(html).toMatch(/<input[^>]*id="sec-new-pw"[^>]*>/);
    expect(html).toMatch(/aria-describedby="sec-new-pw-hint"/);
    expect(html).toContain(`At least ${PASSWORD_MIN_LENGTH} characters.`);
    expect(html).toContain('id="sec-confirm-new-pw"');
    expect(html).not.toMatch(/value="[^"]+"/);
    expect(html).toContain(">Cancel<");
    expect(html).toContain(">Update password<");
  });

  it("has no current-password field when the account has no password", () => {
    const html = renderToStaticMarkup(
      <PasswordDialog
        hasPassword={false}
        onClose={() => {}}
        onSaved={() => {}}
      />,
    );
    expect(html).not.toContain("sec-current-pw");
    expect(html).toContain(">Set password<");
    expect(
      passwordUpdateBody({ current: "x", next: long, confirm: long }, false),
    ).toEqual({ currentPassword: undefined, newPassword: long });
  });

  it.each([
    [
      { current: "", next: long, confirm: long },
      true,
      "Enter your current password to change it.",
    ],
    [
      { current: "old", next: "", confirm: long },
      true,
      "Fill in all three fields to change your password.",
    ],
    [
      { current: "", next: long, confirm: "" },
      false,
      "Fill in both password fields to set one.",
    ],
    [
      { current: "old", next: long, confirm: `${long}b` },
      true,
      "The two new password fields do not match. Retype them and try again.",
    ],
    [
      { current: "old", next: "short", confirm: "short" },
      true,
      `Your new password needs at least ${PASSWORD_MIN_LENGTH} characters. Add a few more.`,
    ],
  ])(
    "keeps the dialog open with the sentence for %j",
    async (draft, hasPassword, sentence) => {
      const calls = stubFetch();
      expect(passwordDraftProblem(draft, hasPassword)).toBe(sentence);
      expect(await savePassword(draft, hasPassword)).toBe(sentence);
      expect(calls).toHaveLength(0);
    },
  );

  it("saves the typed draft with PATCH and reports success on the page once closed", async () => {
    const calls = stubFetch();
    const onSaved = vi.fn();
    const onClose = vi.fn();
    const props = { hasPassword: true, onClose, onSaved };
    const first = direct(PasswordDialog, props);
    expect(dialogProps(first).dirty).toBe(false);
    typeInto(byId(first, "sec-current-pw"), "old pw");
    typeInto(byId(first, "sec-new-pw"), long);
    typeInto(byId(first, "sec-confirm-new-pw"), long);
    const edited = direct(PasswordDialog, props);
    expect(dialogProps(edited).dirty).toBe(true);
    expect(await dialogProps(edited).onSave()).toBeUndefined();
    expect(calls).toEqual([
      {
        url: API.AUTH.UPDATE,
        method: "PATCH",
        body: { currentPassword: "old pw", newPassword: long },
      },
    ]);
    expect(onSaved).toHaveBeenCalledTimes(1);

    const success = vi.fn();
    const parent = baseProps({ setSuccess: success });
    hooks.states = [];
    const tree = direct(ProfileSecurityTab, parent);
    (byText(tree, "Change password")!.props.onClick as () => void)();
    const open = ofType(direct(ProfileSecurityTab, parent), PasswordDialog)!;
    (open.props.onSaved as () => void)();
    expect(success).toHaveBeenCalledWith("Password updated.");
  });

  it("maps a refused save to its message and keeps the dialog open", async () => {
    stubFetch(() => ({ ok: false, data: { error: "Incorrect password." } }));
    const onSaved = vi.fn();
    const props = { hasPassword: true, onClose: vi.fn(), onSaved };
    const first = direct(PasswordDialog, props);
    typeInto(byId(first, "sec-current-pw"), "wrong");
    typeInto(byId(first, "sec-new-pw"), long);
    typeInto(byId(first, "sec-confirm-new-pw"), long);
    expect(await dialogProps(direct(PasswordDialog, props)).onSave()).toBe(
      "Incorrect password.",
    );
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("closes through the site's handler without saving, and asks first once typed into", () => {
    const calls = stubFetch();
    const onClose = vi.fn();
    const props = { hasPassword: true, onClose, onSaved: vi.fn() };
    const el = direct(PasswordDialog, props);
    expect(
      editCloseDecision({ busy: false, dirty: dialogProps(el).dirty ?? false }),
    ).toBe("close");
    dialogProps(el).onOpenChange(false);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(0);
    expect(isPasswordDraftDirty({ current: "", next: "x", confirm: "" })).toBe(
      true,
    );
    expect(editCloseDecision({ busy: false, dirty: true })).toBe(
      "confirm-discard",
    );
  });
});

/* ── backup codes ── */

describe("RegenerateBackupCodesDialog", () => {
  const codes = ["aaaa-1111", "bbbb-2222"];
  const appUser = { user: { totpEnabled: true, twoFactorMethod: "app" } };

  it("opens from New codes and is compact, small and destructive", () => {
    const props = baseProps(appUser);
    const tree = direct(ProfileSecurityTab, props);
    const trigger = byText(tree, "New codes")!;
    expect(clearsTargetFloor(trigger.props.className)).toBe(true);
    (trigger.props.onClick as () => void)();
    expect(
      ofType(direct(ProfileSecurityTab, props), RegenerateBackupCodesDialog),
    ).toBeDefined();

    const html = renderToStaticMarkup(
      <RegenerateBackupCodesDialog onClose={() => {}} onIssued={() => {}} />,
    );
    expect(html).toContain('data-tier="compact"');
    expect(html).toContain('data-size="sm"');
    expect(html).toContain('data-destructive="true"');
    expect(html).toContain(
      "Your 8 current codes stop working the moment new ones are issued.",
    );
    expect(html).toContain('id="regen-backup-password"');
    expect(html).toContain(">Generate new codes<");
    expect(html).toContain(">Cancel<");
  });

  it("hands the new set to the tab's takeover and never renders the codes itself", async () => {
    const calls = stubFetch(() => ({ ok: true, data: { backupCodes: codes } }));
    const onIssued = vi.fn();
    const props = { onClose: vi.fn(), onIssued };
    typeValue(
      byId(direct(RegenerateBackupCodesDialog, props), "regen-backup-password"),
      "pw",
    );
    const edited = direct(RegenerateBackupCodesDialog, props);
    expect(await dialogProps(edited).onSave()).toBeUndefined();
    expect(calls).toEqual([
      {
        url: API.AUTH.TWO_FA.BACKUP_CODES,
        method: "POST",
        body: { password: "pw" },
      },
    ]);
    expect(onIssued).toHaveBeenCalledWith(codes);
    expect(textOf(edited)).not.toContain("aaaa-1111");

    // The tab: the dialog's onIssued puts the set in the takeover.
    const success = vi.fn();
    const parent = baseProps({ ...appUser, setSuccess: success });
    hooks.states = [];
    (
      byText(direct(ProfileSecurityTab, parent), "New codes")!.props
        .onClick as () => void
    )();
    const dialog = ofType(
      direct(ProfileSecurityTab, parent),
      RegenerateBackupCodesDialog,
    )!;
    (dialog.props.onIssued as (c: string[]) => void)(codes);
    const takeover = direct(ProfileSecurityTab, parent);
    expect(textOf(takeover)).toContain("Save these backup codes now");
    expect(textOf(takeover)).toContain("aaaa-1111");
    expect(ofType(takeover, RegenerateBackupCodesDialog)).toBeUndefined();
    expect(success).toHaveBeenCalledWith("New backup codes generated.");
  });

  it("keeps the dialog open with the server's message, and the page banner untouched", async () => {
    stubFetch(() => ({ ok: false, data: { error: "Incorrect password." } }));
    expect(await regenerateBackupCodes("nope")).toEqual({
      ok: false,
      error: "Incorrect password.",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    const props = { onClose: vi.fn(), onIssued: vi.fn() };
    typeValue(
      byId(direct(RegenerateBackupCodesDialog, props), "regen-backup-password"),
      "pw",
    );
    expect(
      await dialogProps(direct(RegenerateBackupCodesDialog, props)).onSave(),
    ).toBe(
      "We could not reach the server. Check your connection and try again.",
    );
    expect(props.onIssued).not.toHaveBeenCalled();
  });

  it("closes through the site's handler without saving", () => {
    const calls = stubFetch();
    const props = { onClose: vi.fn(), onIssued: vi.fn() };
    dialogProps(direct(RegenerateBackupCodesDialog, props)).onOpenChange(false);
    expect(props.onClose).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(0);
  });
});

/* ── authenticator ── */

describe("AuthenticatorSetupDialog", () => {
  const setup = {
    uri: "otpauth://totp/VulnRadar:dev?secret=ABC",
    secret: "ABCDEF234567",
  };

  it("opens once the setup payload has resolved, and closing drops it", async () => {
    const calls = stubFetch(() => ({ ok: true, data: setup }));
    const props = baseProps();
    const trigger = byText(
      direct(ProfileSecurityTab, props),
      "Set up authenticator app",
    )!;
    expect(clearsTargetFloor(trigger.props.className)).toBe(true);
    expect(trigger.props["aria-expanded"]).toBeUndefined();
    await (trigger.props.onClick as () => Promise<void>)();
    // Starting writes a new secret, so it is a POST the CSRF check covers,
    // never the GET that any page could fire.
    expect(calls).toEqual([
      { url: API.AUTH.TWO_FA.SETUP, method: "POST", body: { action: "start" } },
    ]);
    const dialog = ofType(
      direct(ProfileSecurityTab, props),
      AuthenticatorSetupDialog,
    )!;
    expect(dialog.props.setup).toEqual(setup);
    // The site's close handler is resetEnrolment: the secret goes with it.
    (dialog.props.onClose as () => void)();
    expect(
      ofType(direct(ProfileSecurityTab, props), AuthenticatorSetupDialog),
    ).toBeUndefined();
  });

  it("shows the QR on a white quiet zone and the key with a copy button on the scan step", () => {
    const html = renderToStaticMarkup(
      <AuthenticatorSetupDialog
        setup={setup}
        onClose={() => {}}
        onEnabled={() => {}}
      />,
    );
    expect(html).toContain('data-size="md"');
    expect(html).toMatch(/bg-white p-3/);
    expect(html).toContain("<svg");
    expect(html).toContain(setup.secret);
    expect(html).toContain('aria-label="Copy the setup key"');
    expect(html).toContain(">I have added it<");
    expect(html).toContain(">Cancel<");
    expect(html).not.toContain("rounded-xl");
  });

  it("moves to verify and stays open when the scan step is saved", async () => {
    const calls = stubFetch();
    const props = { setup, onClose: vi.fn(), onEnabled: vi.fn() };
    const scan = direct(AuthenticatorSetupDialog, props);
    expect(await dialogProps(scan).onSave()).toBe(KEEP_OPEN);
    expect(calls).toHaveLength(0);
    const verify = direct(AuthenticatorSetupDialog, props);
    expect(dialogProps(verify).saveLabel).toBe("Verify and turn on");
    expect(dialogProps(verify).canSave).toBe(false);
    expect(byText(verify, "Back to the QR code")).toBeDefined();
    expect(byId(verify, "setup-2fa-code").props.value).toBe("");
    expect(byId(verify, "setup-2fa-password").props.value).toBe("");
  });

  it("verifies the typed code and password, and hands the codes to the tab", async () => {
    const codes = ["c1", "c2"];
    const calls = stubFetch(() => ({ ok: true, data: { backupCodes: codes } }));
    const props = { setup, onClose: vi.fn(), onEnabled: vi.fn() };
    await dialogProps(direct(AuthenticatorSetupDialog, props)).onSave();
    const verify = direct(AuthenticatorSetupDialog, props);
    typeInto(byId(verify, "setup-2fa-code"), "12a3456");
    typeInto(byId(verify, "setup-2fa-password"), " pw ");
    const ready = direct(AuthenticatorSetupDialog, props);
    expect(dialogProps(ready).dirty).toBe(true);
    expect(dialogProps(ready).canSave).toBe(true);
    expect(await dialogProps(ready).onSave()).toBeUndefined();
    expect(calls).toEqual([
      {
        url: API.AUTH.TWO_FA.SETUP,
        method: "POST",
        body: { code: "123456", currentPassword: " pw " },
      },
    ]);
    expect(props.onEnabled).toHaveBeenCalledWith(codes);

    const success = vi.fn();
    const parent = baseProps({ setSuccess: success });
    hooks.states = [];
    stubFetch(() => ({ ok: true, data: setup }));
    await (
      byText(direct(ProfileSecurityTab, parent), "Set up authenticator app")!
        .props.onClick as () => Promise<void>
    )();
    const dialog = ofType(
      direct(ProfileSecurityTab, parent),
      AuthenticatorSetupDialog,
    )!;
    (dialog.props.onEnabled as (c: string[]) => void)(codes);
    const takeover = direct(ProfileSecurityTab, parent);
    expect(textOf(takeover)).toContain("Save these backup codes now");
    expect(refreshAuthCache).toHaveBeenCalledTimes(1);
    expect(success).toHaveBeenCalledWith(
      "Authenticator app is on. Save your backup codes.",
    );
  });

  it("keeps a wrong code inside the dialog", async () => {
    stubFetch(() => ({ ok: false, data: {} }));
    expect(await verifyAuthenticator("000000", "pw")).toEqual({
      ok: false,
      error:
        "That code did not match. Codes expire every 30 seconds, so try the current one.",
    });
  });

  it("goes back to the QR code from the verify step", async () => {
    const props = { setup, onClose: vi.fn(), onEnabled: vi.fn() };
    await dialogProps(direct(AuthenticatorSetupDialog, props)).onSave();
    const verify = direct(AuthenticatorSetupDialog, props);
    (byText(verify, "Back to the QR code")!.props.onClick as () => void)();
    expect(dialogProps(direct(AuthenticatorSetupDialog, props)).saveLabel).toBe(
      "I have added it",
    );
  });

  it("calls resetEnrolment on any close and never saves", () => {
    const calls = stubFetch();
    const props = { setup, onClose: vi.fn(), onEnabled: vi.fn() };
    dialogProps(direct(AuthenticatorSetupDialog, props)).onOpenChange(false);
    expect(props.onClose).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(0);
  });
});

/* ── email codes ── */

describe("EnableEmailCodesDialog", () => {
  it("opens from Turn on email codes, which the authenticator app disables", () => {
    const props = baseProps();
    const trigger = byText(
      direct(ProfileSecurityTab, props),
      "Turn on email codes",
    )!;
    expect(clearsTargetFloor(trigger.props.className)).toBe(true);
    expect(trigger.props.disabled).toBe(false);
    expect(trigger.props["aria-expanded"]).toBeUndefined();
    (trigger.props.onClick as () => void)();
    expect(
      ofType(direct(ProfileSecurityTab, props), EnableEmailCodesDialog),
    ).toBeDefined();

    hooks.states = [];
    const app = direct(
      ProfileSecurityTab,
      baseProps({ user: { totpEnabled: true, twoFactorMethod: "app" } }),
    );
    expect(
      byText(app, "Turn off the authenticator app first")!.props.disabled,
    ).toBe(true);
    hooks.states = [];
    const email = direct(
      ProfileSecurityTab,
      baseProps({ user: { totpEnabled: true, twoFactorMethod: "email" } }),
    );
    expect(byText(email, "Turn off email codes first")!.props.disabled).toBe(
      true,
    );
  });

  it("renders compact and small with one empty password field", () => {
    const html = renderToStaticMarkup(
      <EnableEmailCodesDialog
        email="dev@example.com"
        onClose={() => {}}
        onEnabled={() => {}}
      />,
    );
    expect(html).toContain('data-tier="compact"');
    expect(html).toContain('data-size="sm"');
    expect(html).toContain("dev@example.com");
    expect(html.match(/type="password"/g)).toHaveLength(1);
    // The first Save only mails a code; turning on is the second.
    expect(html).toContain(">Send a confirmation code<");
    expect(html).toContain(">Cancel<");
  });

  it("mails a confirmation code first and turns email codes on only once it comes back", async () => {
    const calls = stubFetch(() => ({
      ok: true,
      data: { codeSent: true, maskedEmail: "de***@example.com" },
    }));
    const props = { onClose: vi.fn(), onEnabled: vi.fn() };
    typeValue(
      byId(direct(EnableEmailCodesDialog, props), "enable-email-2fa-password"),
      "pw",
    );
    expect(
      await dialogProps(direct(EnableEmailCodesDialog, props)).onSave(),
    ).toBe(KEEP_OPEN);
    expect(props.onEnabled).not.toHaveBeenCalled();

    const confirm = direct(EnableEmailCodesDialog, props);
    expect(dialogProps(confirm).saveLabel).toBe("Turn on email codes");
    expect(textOf(dialogProps(confirm).description)).toContain(
      "de***@example.com",
    );
    expect(dialogProps(confirm).canSave).toBe(false);
    typeAsBrowser(confirm, "enable-email-2fa-code", "12a3456");
    const ready = direct(EnableEmailCodesDialog, props);
    expect(dialogProps(ready).canSave).toBe(true);
    expect(await dialogProps(ready).onSave()).toBeUndefined();

    expect(calls).toEqual([
      {
        url: API.AUTH.TWO_FA.EMAIL_SETUP,
        method: "POST",
        body: { password: "pw" },
      },
      {
        url: API.AUTH.TWO_FA.EMAIL_SETUP,
        method: "POST",
        body: { password: "pw", code: "123456" },
      },
    ]);
    expect(props.onEnabled).toHaveBeenCalledTimes(1);

    const success = vi.fn();
    const parent = baseProps({ setSuccess: success });
    hooks.states = [];
    (
      byText(direct(ProfileSecurityTab, parent), "Turn on email codes")!.props
        .onClick as () => void
    )();
    (
      ofType(direct(ProfileSecurityTab, parent), EnableEmailCodesDialog)!.props
        .onEnabled as () => void
    )();
    const after = direct(ProfileSecurityTab, parent);
    expect(ofType(after, EnableEmailCodesDialog)).toBeUndefined();
    expect(byText(after, "Turn off email codes")).toBeDefined();
    expect(refreshAuthCache).toHaveBeenCalledTimes(1);
    expect(success).toHaveBeenCalledWith("Email codes are on.");
  });

  it("keeps a refused password inside the dialog and closes without saving", async () => {
    stubFetch(() => ({ ok: false, data: {} }));
    const props = { onClose: vi.fn(), onEnabled: vi.fn() };
    typeValue(
      byId(direct(EnableEmailCodesDialog, props), "enable-email-2fa-password"),
      "pw",
    );
    expect(
      await dialogProps(direct(EnableEmailCodesDialog, props)).onSave(),
    ).toBe("That password was not accepted. Try again.");
    expect(props.onEnabled).not.toHaveBeenCalled();
    const calls = stubFetch();
    dialogProps(direct(EnableEmailCodesDialog, props)).onOpenChange(false);
    expect(props.onClose).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(0);
  });
});

/* ── turning two-step off ── */

describe("TurnOffTwoFactorDialog", () => {
  it.each([
    [
      "app",
      { totpEnabled: true, twoFactorMethod: "app" },
      "Turn off the authenticator app",
    ],
    [
      "email",
      { totpEnabled: true, twoFactorMethod: "email" },
      "Turn off email codes",
    ],
  ] as const)(
    "opens for %s from a text link with a 24px target and no aria-expanded",
    (method, user, label) => {
      const props = baseProps({ user });
      const link = byText(direct(ProfileSecurityTab, props), label)!;
      expect(link.type).toBe("button");
      expect(link.props["aria-expanded"]).toBeUndefined();
      expect(tokens(link.props.className)).toEqual(
        expect.arrayContaining([
          "underline",
          "focus-visible:ring-2",
          "rounded-sm",
        ]),
      );
      expect(clearsTargetFloor(link.props.className)).toBe(true);
      (link.props.onClick as () => void)();
      const dialog = ofType(
        direct(ProfileSecurityTab, props),
        TurnOffTwoFactorDialog,
      )!;
      expect(dialog.props.method).toBe(method);
    },
  );

  it("renders compact, small, destructive, with Turn off and Keep it on", () => {
    const app = renderToStaticMarkup(
      <TurnOffTwoFactorDialog
        method="app"
        onClose={() => {}}
        onTurnedOff={() => {}}
      />,
    );
    expect(app).toContain('data-tier="compact"');
    expect(app).toContain('data-size="sm"');
    expect(app).toContain('data-destructive="true"');
    expect(app).toContain(
      "Your authenticator entry and all 8 backup codes are deleted.",
    );
    expect(app).toContain(">Turn off<");
    expect(app).toContain(">Keep it on<");
    const email = renderToStaticMarkup(
      <TurnOffTwoFactorDialog
        method="email"
        onClose={() => {}}
        onTurnedOff={() => {}}
      />,
    );
    expect(email).toContain("We stop emailing sign-in codes.");
    expect(email).not.toContain("backup codes");
  });

  it("sends POST DISABLE for the app and DELETE EMAIL_SETUP for email", async () => {
    expect(turnOffTwoFactorRequest("app")).toEqual({
      url: API.AUTH.TWO_FA.DISABLE,
      method: "POST",
    });
    expect(turnOffTwoFactorRequest("email")).toEqual({
      url: API.AUTH.TWO_FA.EMAIL_SETUP,
      method: "DELETE",
    });
    for (const method of ["app", "email"] as const) {
      hooks.states = [];
      const calls = stubFetch();
      const props = { method, onClose: vi.fn(), onTurnedOff: vi.fn() };
      typeValue(
        byId(
          direct(TurnOffTwoFactorDialog, props),
          `disable-${method}-2fa-password`,
        ),
        "pw",
      );
      expect(
        await dialogProps(direct(TurnOffTwoFactorDialog, props)).onSave(),
      ).toBeUndefined();
      expect(calls).toEqual([
        method === "app"
          ? {
              url: API.AUTH.TWO_FA.DISABLE,
              method: "POST",
              body: { password: "pw" },
            }
          : {
              url: API.AUTH.TWO_FA.EMAIL_SETUP,
              method: "DELETE",
              body: { password: "pw" },
            },
      ]);
      expect(props.onTurnedOff).toHaveBeenCalledTimes(1);
    }
  });

  it("turns two-step off in the tab with the method's sentence", () => {
    const success = vi.fn();
    const parent = baseProps({
      user: { totpEnabled: true, twoFactorMethod: "email" },
      setSuccess: success,
    });
    (
      byText(direct(ProfileSecurityTab, parent), "Turn off email codes")!.props
        .onClick as () => void
    )();
    (
      ofType(direct(ProfileSecurityTab, parent), TurnOffTwoFactorDialog)!.props
        .onTurnedOff as () => void
    )();
    const after = direct(ProfileSecurityTab, parent);
    expect(ofType(after, TurnOffTwoFactorDialog)).toBeUndefined();
    expect(byText(after, "Turn on email codes")).toBeDefined();
    expect(refreshAuthCache).toHaveBeenCalledTimes(1);
    expect(success).toHaveBeenCalledWith(
      "Email codes turned off. Your password is now the only thing protecting this account.",
    );
  });

  it("keeps a refused password inside the dialog and closes without saving", async () => {
    stubFetch(() => ({ ok: false, data: { error: "Incorrect password." } }));
    expect(await turnOffTwoFactor("app", "nope")).toBe("Incorrect password.");
    const calls = stubFetch();
    const props = {
      method: "app" as const,
      onClose: vi.fn(),
      onTurnedOff: vi.fn(),
    };
    dialogProps(direct(TurnOffTwoFactorDialog, props)).onOpenChange(false);
    expect(props.onClose).toHaveBeenCalledTimes(1);
    expect(props.onTurnedOff).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });
});

/* ── what stays as it was ── */

describe("the rest of the tab", () => {
  it("reports no dialog failure through the page-level setError", () => {
    // The dialogs are defined above the tab and never see setError; the
    // setup-payload fetch still uses it, because it fails before any dialog
    // has opened.
    const start = SOURCE.indexOf("const NETWORK_ERROR");
    const end = SOURCE.indexOf("interface ProfileSecurityTabProps");
    expect(SOURCE.slice(start, end)).not.toContain("setError");
    expect(SOURCE).not.toMatch(
      /setPasswordError|setDisableError|setEmailEnableError|setEnrolError/,
    );
  });

  it("keeps the sign-out-everywhere ConfirmDialog and the per-row confirms", () => {
    expect(SOURCE).toContain('title="Sign out everywhere?"');
    expect(SOURCE).toContain('title: "Sign out this session?"');
    expect(SOURCE).toContain('title: "Remove this trusted device?"');
  });

  it("writes no em dash, en dash or middle dot into the new dialog copy", () => {
    const start = SOURCE.indexOf("export function PasswordDialog");
    const end = SOURCE.indexOf("interface ProfileSecurityTabProps");
    expect(SOURCE.slice(start, end)).not.toMatch(/[—–·]/);
  });
});

describe("setting a first password", () => {
  // An OAuth-only account that sets a password has a hash from then on. The
  // tab reads hasPassword from the page's user, so unless the save patches it
  // the tab keeps saying no password is on file, and the next change leaves out
  // the current-password field the server now asks for.
  it("tells the page the account has a password now", () => {
    const start = SOURCE.indexOf("<PasswordDialog");
    const end = SOURCE.indexOf("/>", start);
    expect(start).toBeGreaterThan(-1);
    const call = SOURCE.slice(start, end);
    expect(call).toMatch(
      /onSaved=\{\(\) => \{[\s\S]*if \(!hasPassword\) onUserPatch\?\.\(\{ hasPassword: true \}\);/,
    );
  });
});

/* ── an account with no password steps up by email ── */

describe("an account with no password confirms with the mailed step-up", () => {
  // A stolen session used to be enough for every one of these on an account
  // created through a provider. The server now wants the step-up cookie
  // (lib/auth/reauth.ts), and each dialog shows EmailStepUp where the
  // password field was.
  const setup = { uri: "otpauth://totp/x?secret=A", secret: "A" };
  const cases: [string, (props: never) => unknown, object, string][] = [
    [
      "RegenerateBackupCodesDialog",
      RegenerateBackupCodesDialog,
      { onClose: vi.fn(), onIssued: vi.fn() },
      "regen-backup-password",
    ],
    [
      "EnableEmailCodesDialog",
      EnableEmailCodesDialog,
      { onClose: vi.fn(), onEnabled: vi.fn() },
      "enable-email-2fa-password",
    ],
    [
      "TurnOffTwoFactorDialog (app)",
      TurnOffTwoFactorDialog,
      { method: "app", onClose: vi.fn(), onTurnedOff: vi.fn() },
      "disable-app-2fa-password",
    ],
    [
      "TurnOffTwoFactorDialog (email)",
      TurnOffTwoFactorDialog,
      { method: "email", onClose: vi.fn(), onTurnedOff: vi.fn() },
      "disable-email-2fa-password",
    ],
  ];

  it.each(cases)(
    "%s renders the step-up and no password input",
    (_name, component, props, id) => {
      const Component = component as (
        p: Record<string, unknown>,
      ) => ReactElement;
      const without = renderToStaticMarkup(
        <Component {...props} hasPassword={false} />,
      );
      expect(without).not.toContain('type="password"');
      expect(without).not.toContain(`id="${id}"`);
      expect(without).toContain(">Email me a code<");

      const withPassword = renderToStaticMarkup(
        <Component {...props} hasPassword />,
      );
      expect(withPassword).toContain('type="password"');
      expect(withPassword).toContain(`id="${id}"`);
      expect(withPassword).not.toContain(">Email me a code<");
    },
  );

  it.each(cases)(
    "%s holds Save until the step-up is done, then sends no password",
    async (_name, component, props) => {
      const calls = stubFetch(() => ({ ok: true, data: { backupCodes: [] } }));
      const full = { ...props, hasPassword: false } as never;
      const first = direct(component, full);
      expect(dialogProps(first).canSave).toBe(false);

      // The step-up sits in ReauthField, which hands its onReady straight
      // through as onStepUpDone.
      const field = find(first, (el) => "onStepUpDone" in el.props)!;
      expect(field.props.hasPassword).toBe(false);
      (field.props.onStepUpDone as () => void)();
      const ready = direct(component, full);
      expect(dialogProps(ready).canSave).toBe(true);
      await dialogProps(ready).onSave();
      expect(calls).toHaveLength(1);
      expect(calls[0].body).toEqual({});
    },
  );

  it("AuthenticatorSetupDialog swaps the password for the step-up on the verify step", async () => {
    const calls = stubFetch(() => ({ ok: true, data: { backupCodes: [] } }));
    const props = {
      setup,
      onClose: vi.fn(),
      onEnabled: vi.fn(),
      hasPassword: false,
    };
    await dialogProps(direct(AuthenticatorSetupDialog, props)).onSave();
    const verify = direct(AuthenticatorSetupDialog, props);
    const html = renderToStaticMarkup(verify);
    expect(html).not.toContain('id="setup-2fa-password"');
    expect(html).toContain(">Email me a code<");

    typeAsBrowser(verify, "setup-2fa-code", "123456");
    expect(dialogProps(direct(AuthenticatorSetupDialog, props)).canSave).toBe(
      false,
    );
    (
      ofType(direct(AuthenticatorSetupDialog, props), EmailStepUp)!.props
        .onReady as () => void
    )();
    const ready = direct(AuthenticatorSetupDialog, props);
    expect(dialogProps(ready).canSave).toBe(true);
    await dialogProps(ready).onSave();
    expect(calls.map((c) => c.body)).toEqual([{ code: "123456" }]);
  });

  it("PasswordDialog asks for the step-up before setting a first password", () => {
    const html = renderToStaticMarkup(
      <PasswordDialog
        hasPassword={false}
        onClose={() => {}}
        onSaved={() => {}}
      />,
    );
    expect(html).not.toContain("sec-current-pw");
    expect(html).toContain(">Email me a code<");
    const props = { hasPassword: false, onClose: vi.fn(), onSaved: vi.fn() };
    const first = direct(PasswordDialog, props);
    expect(dialogProps(first).canSave).toBe(false);
    (ofType(first, EmailStepUp)!.props.onReady as () => void)();
    expect(dialogProps(direct(PasswordDialog, props)).canSave).toBe(true);
  });

  it("lets Save go at once on a server that cannot send mail, for the server to judge", () => {
    const props = {
      onClose: vi.fn(),
      onIssued: vi.fn(),
      hasPassword: false,
      emailConfigured: false,
    };
    const tree = direct(RegenerateBackupCodesDialog, props);
    expect(dialogProps(tree).canSave).toBe(true);
    const field = find(tree, (el) => "onStepUpDone" in el.props)!;
    expect(field.props.emailConfigured).toBe(false);
    expect(
      renderToStaticMarkup(<RegenerateBackupCodesDialog {...props} />),
    ).toContain(">Sign in again<");
  });

  it("hands every dialog the account's hasPassword from the tab", () => {
    const props = baseProps({
      user: { hasPassword: false, totpEnabled: true, twoFactorMethod: "app" },
    });
    (
      byText(direct(ProfileSecurityTab, props), "New codes")!.props
        .onClick as () => void
    )();
    const dialog = ofType(
      direct(ProfileSecurityTab, props),
      RegenerateBackupCodesDialog,
    )!;
    expect(dialog.props.hasPassword).toBe(false);
    expect(dialog.props.emailConfigured).toBe(true);
  });
});

/* ── email codes need a server that sends mail ── */

describe("email codes on a server that cannot send mail", () => {
  it("does not offer them", () => {
    clientConfig.value = { emailConfigured: false };
    const tree = direct(ProfileSecurityTab, baseProps());
    expect(byText(tree, "Turn on email codes")).toBeUndefined();
    expect(textOf(tree)).not.toContain("Email codes");
  });

  it("still lets an account that has them turn them off", () => {
    clientConfig.value = { emailConfigured: false };
    const tree = direct(
      ProfileSecurityTab,
      baseProps({ user: { totpEnabled: true, twoFactorMethod: "email" } }),
    );
    expect(byText(tree, "Turn off email codes")).toBeDefined();
  });

  it("offers them while the config says nothing either way", () => {
    const tree = direct(ProfileSecurityTab, baseProps());
    expect(byText(tree, "Turn on email codes")).toBeDefined();
  });
});

/* ── a failed save points every field at the dialog's alert ── */

describe("a failed save marks the dialog's fields", () => {
  // Moving the fields into EditDialog lost their aria-invalid and
  // aria-describedby: the failure showed only in the dialog's alert, and a
  // screen reader on the field heard nothing about it.
  beforeEach(() => {
    dialogError.error = "Incorrect password.";
  });

  function inputs(html: string): string[] {
    return html.match(/<input[^>]*>/g) ?? [];
  }

  it.each([
    [
      "PasswordDialog",
      <PasswordDialog
        key="p"
        hasPassword
        onClose={() => {}}
        onSaved={() => {}}
      />,
      3,
    ],
    [
      "RegenerateBackupCodesDialog",
      <RegenerateBackupCodesDialog
        key="r"
        onClose={() => {}}
        onIssued={() => {}}
      />,
      1,
    ],
    [
      "EnableEmailCodesDialog",
      <EnableEmailCodesDialog
        key="e"
        onClose={() => {}}
        onEnabled={() => {}}
      />,
      1,
    ],
    [
      "TurnOffTwoFactorDialog",
      <TurnOffTwoFactorDialog
        key="t"
        method="app"
        onClose={() => {}}
        onTurnedOff={() => {}}
      />,
      1,
    ],
  ] as const)("%s", (_name, element, count) => {
    const fields = inputs(renderToStaticMarkup(element));
    expect(fields).toHaveLength(count);
    for (const field of fields) {
      expect(field).toContain('aria-invalid="true"');
      expect(field).toMatch(/aria-describedby="[^"]*edit-dialog-error"/);
    }
  });

  it("keeps the new password's own hint alongside the alert", () => {
    const html = renderToStaticMarkup(
      <PasswordDialog hasPassword onClose={() => {}} onSaved={() => {}} />,
    );
    expect(html).toMatch(
      /id="sec-new-pw"[^>]*aria-describedby="sec-new-pw-hint edit-dialog-error"|aria-describedby="sec-new-pw-hint edit-dialog-error"[^>]*id="sec-new-pw"/,
    );
  });

  it("AuthenticatorSetupDialog, on the verify step", async () => {
    const props = {
      setup: { uri: "otpauth://totp/x?secret=A", secret: "A" },
      onClose: vi.fn(),
      onEnabled: vi.fn(),
    };
    await dialogProps(direct(AuthenticatorSetupDialog, props)).onSave();
    const fields = inputs(
      renderToStaticMarkup(direct(AuthenticatorSetupDialog, props)),
    );
    expect(fields).toHaveLength(2);
    for (const field of fields) {
      expect(field).toContain('aria-invalid="true"');
    }
  });

  it("marks nothing while there is no failure", () => {
    dialogError.error = null;
    const html = renderToStaticMarkup(
      <RegenerateBackupCodesDialog onClose={() => {}} onIssued={() => {}} />,
    );
    expect(html).not.toContain("aria-invalid");
    expect(html).not.toContain("edit-dialog-error");
  });
});

describe("the session and device rows", () => {
  it("join the address and the date without a middle dot anywhere in the tab", () => {
    expect(SOURCE).not.toMatch(/[—–·]/);
    expect(SOURCE).toContain(", signed in ");
    expect(SOURCE).toContain(", last used ");
  });
});
