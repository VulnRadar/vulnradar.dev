// @vitest-environment jsdom
/**
 * Staff invites on the Staff tab, by role.
 *
 * The tab opens for anyone holding VIEW_AUDIT_LOG (moderator, security
 * analyst), and every invite endpoint is admin-only. Those roles were offered
 * Invite staff, which ended in a password prompt and a refusal, and the panel
 * asked for an invite list it was always refused. Below the admin tier the
 * button, the pill and the request are now all absent.
 *
 * The list also carries the expired invites now, so the header pill counts
 * them apart from the live ones and the modal lists them for revoking.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

let role = "admin";
vi.mock("@/components/providers/auth-provider", () => ({
  useAuth: () => ({ me: { userId: 1, role }, isLoading: false }),
}));

const { StaffList, canManageStaffInvites } =
  await import("@/components/admin/staff/staff-list");

const fetchMock = vi.fn();

function props() {
  return {
    activeAdmins: [],
    adminsLoading: false,
    adminsError: null,
    fetchActiveAdmins: () => {},
  };
}

const day = 24 * 60 * 60 * 1000;
const invite = (id: number, email: string, expired: boolean) => ({
  id,
  email,
  role: "support",
  created_at: new Date(Date.now() - 8 * day).toISOString(),
  expires_at: new Date(Date.now() + (expired ? -day : 6 * day)).toISOString(),
  expired,
  invited_by_name: "Root",
  invited_by_email: "root@example.com",
});

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(
    new Response(
      JSON.stringify({
        invites: [
          invite(2, "live@example.com", false),
          invite(1, "lapsed@example.com", true),
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    ),
  );
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("canManageStaffInvites", () => {
  it.each(["admin", "super_admin"])("is true for %s", (r) => {
    expect(canManageStaffInvites(r)).toBe(true);
  });

  it.each([
    "moderator",
    "security_analyst",
    "support",
    "ops",
    "user",
    null,
    undefined,
  ])("is false for %s", (r) => {
    expect(canManageStaffInvites(r)).toBe(false);
  });
});

describe("the Staff tab's invite controls", () => {
  it.each(["moderator", "security_analyst"])(
    "shows %s no Invite button and never asks for the invite list",
    async (r) => {
      role = r;
      render(<StaffList {...props()} />);
      // Give any effect a chance to fire before asserting it did not.
      await Promise.resolve();
      expect(screen.queryByRole("button", { name: "Invite staff" })).toBeNull();
      expect(screen.queryByText(/expired/)).toBeNull();
      expect(
        fetchMock.mock.calls.some(([url]) =>
          String(url).includes("staff-invites"),
        ),
      ).toBe(false);
    },
  );

  it("shows an admin the Invite button and counts the expired invite on the header", async () => {
    role = "admin";
    render(<StaffList {...props()} />);

    expect(screen.getByRole("button", { name: "Invite staff" })).toBeTruthy();
    const pill = await screen.findByRole("button", {
      name: "1 staff invite expired unaccepted, open invites",
    });
    expect(pill.textContent).toContain("1 expired");
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([url]) =>
          String(url).includes("staff-invites"),
        ),
      ).toBe(true),
    );
  });
});
