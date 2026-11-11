/**
 * The staff-invite and apply-update re-auth dialogs for an account with no
 * password.
 *
 * The server now refuses a staff invite or an update from an account with
 * no password until it has entered a code mailed to its address
 * (lib/auth/reauth.ts). Both dialogs only had a password field, which an
 * admin created through Google, GitHub or Discord has nothing to type into,
 * so every invite and update from such an account ended in a refusal. They
 * show EmailStepUp in its place, and the request carries no password.
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

const { StaffList, staffInviteBody } =
  await import("@/components/admin/staff/staff-list");
const { ApplyUpdateDialog, applyUpdateBody } =
  await import("@/components/admin/features/updater-manager");
const { meHasPassword } =
  await import("@/components/admin/shared/admin-reauth-dialog");

const PASSWORD_INPUT = /<input[^>]*type="password"/;
const STEP_UP = "Email me a code";

function staffList() {
  return renderToStaticMarkup(
    <StaffList
      activeAdmins={[]}
      adminsLoading={false}
      adminsError={null}
      fetchActiveAdmins={() => {}}
    />,
  );
}

function updateDialog(hasPassword: boolean) {
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
  me = { userId: 1, role: "admin" };
});

describe("meHasPassword", () => {
  it("is false only when /auth/me says so", () => {
    expect(meHasPassword({ hasPassword: false })).toBe(false);
    expect(meHasPassword({ hasPassword: true })).toBe(true);
    // Unknown means the field is shown and the server decides.
    expect(meHasPassword({})).toBe(true);
    expect(meHasPassword(null)).toBe(true);
  });
});

describe("the staff invite re-auth dialog", () => {
  it("shows an account with no password the email step-up and no password field", () => {
    me = { userId: 1, role: "admin", hasPassword: false };
    const html = staffList();
    expect(html).toContain(STEP_UP);
    expect(html).not.toMatch(PASSWORD_INPUT);
    expect(html).not.toContain("Re-enter your password");
  });

  it("still asks an account with a password for it", () => {
    me = { userId: 1, role: "admin", hasPassword: true };
    const html = staffList();
    expect(html).toMatch(PASSWORD_INPUT);
    expect(html).toContain("Re-enter your password to confirm.");
    expect(html).not.toContain(STEP_UP);
  });

  it("sends no password key for a step-up confirmation", () => {
    expect(staffInviteBody(" a@example.com ", "ops", undefined)).toEqual({
      email: "a@example.com",
      role: "ops",
    });
    expect(staffInviteBody("a@example.com", "ops", "pw")).toEqual({
      email: "a@example.com",
      role: "ops",
      currentAdminPassword: "pw",
    });
  });
});

describe("the apply-update re-auth dialog", () => {
  it("shows an account with no password the email step-up and no password field", () => {
    const html = updateDialog(false);
    expect(html).toContain(STEP_UP);
    expect(html).not.toMatch(PASSWORD_INPUT);
    expect(html).toContain("installs v4.0.0");
  });

  it("still asks an account with a password for it", () => {
    const html = updateDialog(true);
    expect(html).toMatch(PASSWORD_INPUT);
    expect(html).not.toContain(STEP_UP);
  });

  it("sends no password key for a step-up confirmation", () => {
    expect(applyUpdateBody(undefined, "4.0.0")).toEqual({
      targetVersion: "4.0.0",
    });
    expect(applyUpdateBody("pw", "latest")).toEqual({
      currentAdminPassword: "pw",
      targetVersion: "latest",
    });
  });
});
