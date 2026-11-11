// @vitest-environment jsdom
/**
 * The Security Alerts panel asks the server for unresolved alerts and trusts
 * the server's count for its header.
 *
 * bug-ui-admin-6: it fetched the newest 100 alerts of any kind and filtered
 * out the resolved ones itself, so an unresolved alert older than 100 resolved
 * ones never arrived and the header said "All clear". ux-design-4: its error
 * banner was hand-rolled with no role, so a failed Block was silent to a
 * screen reader.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

const { SecurityAlertsManager, alertsListBody, ALERTS_PAGE_SIZE } =
  await import("@/components/admin/features/security-alerts-manager");

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function alert(id: number, over: Record<string, unknown> = {}) {
  return {
    id,
    user_id: 3,
    alert_type: "brute_force",
    severity: "high",
    description: `Alert ${id}`,
    created_at: "2026-10-01T10:00:00Z",
    user_email: "someone@example.com",
    ...over,
  };
}

const COUNTS = { total: 7, critical: 2, high: 5, medium: 0, low: 0 };

type Answer = (body: Record<string, unknown>) => Response;

function serve(...answers: Answer[]) {
  const sent: Record<string, unknown>[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}"));
      sent.push(body);
      const next = answers.shift();
      if (!next) throw new Error(`unexpected ${body.action}`);
      return next(body);
    }),
  );
  return sent;
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("alertsListBody", () => {
  it("asks for unresolved alerts by default and sends the severity to the server", () => {
    expect(
      alertsListBody({ showResolved: false, severity: "all", offset: 0 }),
    ).toEqual({
      action: "list",
      section: "security_alerts",
      limit: ALERTS_PAGE_SIZE,
      offset: 0,
      unresolved_only: true,
    });
    expect(
      alertsListBody({ showResolved: true, severity: "critical", offset: 100 }),
    ).toMatchObject({
      unresolved_only: false,
      severity: "critical",
      offset: 100,
    });
  });
});

describe("SecurityAlertsManager", () => {
  it("reads the header from the server's unresolved count, not the page", async () => {
    const sent = serve(() =>
      json({ alerts: [alert(1)], hasMore: true, unresolved: COUNTS }),
    );
    render(<SecurityAlertsManager />);

    expect(await screen.findByText("7 unresolved")).toBeTruthy();
    expect(sent[0]).toMatchObject({ unresolved_only: true, offset: 0 });
    expect(screen.queryByText("All clear")).toBeNull();
  });

  it("loads the next page from where the list ends", async () => {
    const sent = serve(
      () => json({ alerts: [alert(1)], hasMore: true, unresolved: COUNTS }),
      () => json({ alerts: [alert(2)], hasMore: false, unresolved: COUNTS }),
    );
    render(<SecurityAlertsManager />);
    fireEvent.click(await screen.findByRole("button", { name: /Load more/ }));

    expect(await screen.findByText("Alert 2")).toBeTruthy();
    expect(screen.getByText("Alert 1")).toBeTruthy();
    expect(sent[1]).toMatchObject({ offset: 1, unresolved_only: true });
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /Load more/ })).toBeNull(),
    );
  });

  it("shows resolved alerts on request, without their action buttons", async () => {
    const sent = serve(
      () =>
        json({
          alerts: [],
          hasMore: false,
          unresolved: { ...COUNTS, total: 0, critical: 0, high: 0 },
        }),
      () =>
        json({
          alerts: [
            alert(9, {
              resolved_at: "2026-10-02T10:00:00Z",
              action_taken: "block_user",
            }),
          ],
          hasMore: false,
          unresolved: { ...COUNTS, total: 0, critical: 0, high: 0 },
        }),
    );
    render(<SecurityAlertsManager />);
    expect(await screen.findByText("All clear")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Show resolved" }));
    expect(await screen.findByText("Alert 9")).toBeTruthy();
    expect(sent[1]).toMatchObject({ unresolved_only: false });
    expect(screen.getByText("Account blocked")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Block user/ })).toBeNull();
  });

  it("refetches with the severity when a severity is picked", async () => {
    const sent = serve(
      () => json({ alerts: [alert(1)], hasMore: false, unresolved: COUNTS }),
      () =>
        json({
          alerts: [alert(4, { severity: "critical" })],
          hasMore: false,
          unresolved: COUNTS,
        }),
    );
    render(<SecurityAlertsManager />);
    await screen.findByText("Alert 1");

    fireEvent.click(screen.getByRole("button", { name: /Critical/ }));
    expect(await screen.findByText("Alert 4")).toBeTruthy();
    expect(sent[1]).toMatchObject({ severity: "critical" });
  });

  it("announces a failed resolve through an alert role", async () => {
    serve(
      () => json({ alerts: [alert(1)], hasMore: false, unresolved: COUNTS }),
      () =>
        json(
          { error: "You cannot act on an account at or above your rank." },
          403,
        ),
    );
    render(<SecurityAlertsManager />);
    fireEvent.click(await screen.findByRole("button", { name: /Resolve/ }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Mark Resolved" }),
    );

    await waitFor(() => {
      const alerts = screen
        .getAllByRole("alert")
        .filter((el) => el.textContent?.includes("at or above your rank"));
      expect(alerts.length).toBeGreaterThan(0);
    });
  });
});
