/**
 * The apply-update dialog asks for a second factor as well as the password.
 *
 * The server refuses an update without one whatever ENFORCE_STAFF_2FA says
 * (lib/auth/staff-step-up.ts). A dialog that only asked for the password
 * would send every update into that refusal, so it asks for the factor the
 * account has: an authenticator code, the mailed code for an account that
 * signs in with email codes, or, with no two-factor at all, nothing but the
 * refusal and the way to Profile > Security.
 *
 * No DOM: renderToStaticMarkup, with the alert-dialog primitive passed
 * through (its portal renders nothing on the server).
 */
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/components/ui/alert-dialog", () => {
  const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return {
    AlertDialog: Pass,
    AlertDialogAction: Pass,
    AlertDialogCancel: Pass,
    AlertDialogBody: Pass,
    AlertDialogContent: Pass,
    AlertDialogDescription: Pass,
    AlertDialogFooter: Pass,
    AlertDialogHeader: Pass,
    AlertDialogTitle: Pass,
  };
});

let me: Record<string, unknown> = {};
vi.mock("@/components/providers/auth-provider", () => ({
  useAuth: () => ({ me, isLoading: false }),
  clearAuthCache: () => {},
}));

const { ApplyUpdateDialog, applyUpdateBody } =
  await import("@/components/admin/features/updater-manager");
const { secondFactorFor, blockedMessage } =
  await import("@/components/admin/shared/staff-second-factor-dialog");
const { SECOND_FACTOR_MESSAGES } =
  await import("@/lib/auth/staff-second-factor-kind");

const PASSWORD_INPUT = /<input[^>]*type="password"/;
const TOTP_INPUT =
  /<input(?=[^>]*inputMode="numeric")(?=[^>]*autoComplete="one-time-code")[^>]*>/;
const TOTP_LABEL = "Code from your authenticator app";
const EMAIL_CODE = "Email me a code";
const CONFIRM = /<button[^>]*>(?:(?!<\/button>).)*Apply update<\/button>/;

function dialog(hasPassword = true) {
  return renderToStaticMarkup(
    <ApplyUpdateDialog
      open
      onOpenChange={() => {}}
      latest="4.0.0"
      hasPassword={hasPassword}
      onConfirm={async () => ({ ok: true })}
    />,
  );
}

beforeEach(() => {
  me = { userId: 1, role: "super_admin", hasPassword: true };
});

describe("the apply-update dialog, by the account's second factor", () => {
  it("asks an authenticator account for the password and a six-digit code", () => {
    me = { ...me, totpEnabled: true, twoFactorMethod: "app" };
    const html = dialog();
    expect(html).toMatch(PASSWORD_INPUT);
    expect(html).toContain(TOTP_LABEL);
    expect(html).toMatch(TOTP_INPUT);
    expect(html).toContain('maxLength="6"');
    expect(html).toContain("Backup codes are not accepted here.");
    expect(html).not.toContain(EMAIL_CODE);
  });

  it("asks an email-code account with a password for the mailed code instead", () => {
    me = { ...me, totpEnabled: true, twoFactorMethod: "email" };
    const html = dialog();
    expect(html).toMatch(PASSWORD_INPUT);
    expect(html).toContain(EMAIL_CODE);
    expect(html).toContain("uses email codes for two-step sign-in");
    expect(html).not.toContain(TOTP_LABEL);
  });

  it("shows an account without two-factor the refusal and the way to turn it on, and no Apply", () => {
    me = { ...me, totpEnabled: false, twoFactorMethod: null };
    const html = dialog();
    expect(html).toContain(SECOND_FACTOR_MESSAGES.none.replaceAll(">", "&gt;"));
    expect(html).toContain('href="/profile?tab=security"');
    expect(html).not.toMatch(PASSWORD_INPUT);
    expect(html).not.toContain(TOTP_LABEL);
    expect(html).not.toMatch(CONFIRM);
    expect(html).toContain(">Cancel<");
  });

  it("gives an account with no password the mailed step-up and then the code", () => {
    me = {
      ...me,
      hasPassword: false,
      totpEnabled: true,
      twoFactorMethod: "app",
    };
    const html = dialog(false);
    expect(html).not.toMatch(PASSWORD_INPUT);
    expect(html).toContain(EMAIL_CODE);
    expect(html).toContain("has no password");
    expect(html).toContain(TOTP_LABEL);
  });

  it("refuses an account with no password whose two-factor is email codes", () => {
    me = {
      ...me,
      hasPassword: false,
      totpEnabled: true,
      twoFactorMethod: "email",
    };
    const html = dialog(false);
    expect(html).toContain(SECOND_FACTOR_MESSAGES.authenticator);
    expect(html).not.toContain(EMAIL_CODE);
    expect(html).not.toMatch(CONFIRM);
  });

  it("holds Apply until both the password and a code are in", () => {
    me = { ...me, totpEnabled: true, twoFactorMethod: "app" };
    expect(dialog()).toMatch(
      /<button[^>]*disabled=""[^>]*>(?:(?!<\/button>).)*Apply update<\/button>/,
    );
  });
});

describe("secondFactorFor", () => {
  it("reads the factor from /auth/me", () => {
    expect(secondFactorFor({ totpEnabled: false })).toBe("none");
    expect(secondFactorFor({ totpEnabled: true, twoFactorMethod: null })).toBe(
      "totp",
    );
    expect(secondFactorFor({ totpEnabled: true, twoFactorMethod: "app" })).toBe(
      "totp",
    );
    expect(
      secondFactorFor({ totpEnabled: true, twoFactorMethod: "email" }),
    ).toBe("email");
    expect(
      secondFactorFor({
        totpEnabled: true,
        twoFactorMethod: "email",
        hasPassword: false,
      }),
    ).toBe("authenticator");
  });

  it("shows the code field while /auth/me has not answered, and lets the server decide", () => {
    expect(secondFactorFor(null)).toBe("totp");
    expect(secondFactorFor({})).toBe("totp");
  });
});

describe("blockedMessage", () => {
  it("blocks no two-factor, an email-only account without a password, and email codes with no mail", () => {
    expect(blockedMessage("none", true)).toBe(SECOND_FACTOR_MESSAGES.none);
    expect(blockedMessage("authenticator", true)).toBe(
      SECOND_FACTOR_MESSAGES.authenticator,
    );
    expect(blockedMessage("email", false)).toBe(SECOND_FACTOR_MESSAGES.noMail);
    expect(blockedMessage("email", true)).toBeNull();
    expect(blockedMessage("totp", false)).toBeNull();
  });
});

describe("applyUpdateBody", () => {
  it("carries the authenticator code as totpCode, and nothing for the email factor", () => {
    expect(applyUpdateBody("pw", "4.0.0", "123456")).toEqual({
      currentAdminPassword: "pw",
      totpCode: "123456",
      targetVersion: "4.0.0",
    });
    expect(applyUpdateBody("pw", "4.0.0", undefined)).toEqual({
      currentAdminPassword: "pw",
      targetVersion: "4.0.0",
    });
  });
});
