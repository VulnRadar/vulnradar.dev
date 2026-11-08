import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSend = vi.hoisted(() => vi.fn());
vi.mock("@/lib/notifications/notifications", () => ({
  sendNotificationEmail: mockSend,
}));

const mockEmail = vi.hoisted(() => vi.fn());
vi.mock("@/lib/email/email", () => ({
  profileNameChangedEmail: mockEmail,
}));

vi.mock("@/lib/api/request-utils", () => ({
  getClientIp: async () => "203.0.113.9",
  getUserAgent: async () => "test-agent",
}));

const { noticeProfileNameChanged } =
  await import("@/lib/notifications/profile-name-changed");

const session = { userId: 7, email: "a@b.test", name: "Old" };

beforeEach(() => {
  mockSend.mockReset();
  mockSend.mockResolvedValue(undefined);
  mockEmail.mockReset();
  mockEmail.mockReturnValue({ subject: "changed" });
});

describe("noticeProfileNameChanged", () => {
  it("mails the account holder the old and the new name", async () => {
    noticeProfileNameChanged(session, "New");

    await vi.waitFor(() => expect(mockSend).toHaveBeenCalledTimes(1));
    expect(mockEmail).toHaveBeenCalledWith("Old", "New", {
      ipAddress: "203.0.113.9",
      userAgent: "test-agent",
    });
    expect(mockSend).toHaveBeenCalledWith({
      userId: 7,
      userEmail: "a@b.test",
      type: "account_changes",
      emailContent: { subject: "changed" },
    });
  });

  it("says Not set when the account had no name", async () => {
    noticeProfileNameChanged({ ...session, name: null }, "New");

    await vi.waitFor(() => expect(mockSend).toHaveBeenCalledTimes(1));
    expect(mockEmail.mock.calls[0][0]).toBe("Not set");
  });

  it("sends nothing when the name did not change", async () => {
    noticeProfileNameChanged(session, "Old");

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("logs a mail failure and does not throw", async () => {
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    mockSend.mockRejectedValueOnce(new Error("smtp down"));

    expect(() => noticeProfileNameChanged(session, "New")).not.toThrow();

    await vi.waitFor(() => expect(error).toHaveBeenCalledTimes(1));
    error.mockRestore();
  });
});
