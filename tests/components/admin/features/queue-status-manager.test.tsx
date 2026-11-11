// @vitest-environment jsdom
/**
 * The Scanner Queue's actions, by role.
 *
 * The tab opens on VIEW_SYSTEM_STATS, which ops holds. "Fail stuck scans"
 * and "Cancel scan" are requireAdmin on the server, and the user record a row
 * links to needs VIEW_USERS, which ops does not hold. Ops was offered all
 * three and each ended in a refusal that read like a transient fault.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

let role = "admin";
vi.mock("@/components/providers/auth-provider", () => ({
  useAuth: () => ({ me: { userId: 1, role }, isLoading: false }),
}));

const { QueueStatusManager, queueAccess } =
  await import("@/components/admin/features/queue-status-manager");
const { STALE_RUNNING_MS } =
  await import("@/components/admin/features/queue-status-utils");

const status = {
  counts: {
    pending: 0,
    running: 1,
    completedLast24h: 3,
    failedLast24h: 0,
    cancelledLast24h: 0,
    refusedLast24h: 0,
    notRunLast24h: 0,
    targetFailedLast24h: 0,
  },
  oldestPendingAgeMs: null,
  // Past every timeout, which is when the sweep is offered at all.
  oldestRunningAgeMs: STALE_RUNNING_MS * 3,
  recentWindowHours: 24,
  generatedAt: new Date().toISOString(),
};

const inflight = {
  ...status,
  inflight: [
    {
      id: 41,
      userId: 77,
      url: "https://example.com/",
      source: "web",
      status: "running",
      startedAt: new Date(Date.now() - STALE_RUNNING_MS * 3).toISOString(),
      currentCategory: null,
    },
  ],
};

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      json(String(url).includes("inflight=1") ? inflight : status),
    ),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function openInflight() {
  render(<QueueStatusManager />);
  fireEvent.click(await screen.findByText(/in flight, oldest first/));
  await screen.findByText("https://example.com/");
}

describe("queueAccess", () => {
  it("gives ops neither the interventions nor the user link", () => {
    expect(queueAccess("ops")).toEqual({
      canIntervene: false,
      canOpenUsers: false,
    });
  });

  it.each(["admin", "super_admin"])("gives %s both", (r) => {
    expect(queueAccess(r)).toEqual({ canIntervene: true, canOpenUsers: true });
  });
});

describe("the Scanner Queue", () => {
  it("shows ops no sweep, no cancel and no link to the user record", async () => {
    role = "ops";
    await openInflight();

    expect(screen.queryByRole("button", { name: /Fail stuck scans/ })).toBe(
      null,
    );
    expect(screen.queryByRole("button", { name: "Cancel scan #41" })).toBe(
      null,
    );
    expect(screen.getByText("user #77").closest("a")).toBeNull();
  });

  it("shows an admin the sweep, the cancel and the user link", async () => {
    role = "admin";
    await openInflight();

    expect(
      screen.getByRole("button", { name: /Fail stuck scans/ }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Cancel scan #41" }),
    ).toBeTruthy();
    expect(
      screen.getByText("user #77").closest("a")?.getAttribute("href"),
    ).toBe("/admin?tab=users&user=77");
  });

  it("reports a failed load through the shared alert", async () => {
    role = "admin";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 500 })),
    );
    render(<QueueStatusManager />);
    const alert = await screen.findByText(/Couldn.t load the scanner queue/);
    expect(alert.closest('[role="alert"]')).not.toBeNull();
  });
});
