// @vitest-environment jsdom
/**
 * The database TLS row on Admin > Overview (enc-6). The boot warning goes to
 * the server log, which a self-hoster on a managed platform may never read,
 * so the same line is shown where the operator already looks for faults.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const { HealthOverview } =
  await import("@/components/admin/features/health-overview");

const WARNING =
  "DATABASE_URL points at a database across the network and the connection is not encrypted.";

const scanQueue = {
  pending: 0,
  running: 0,
  oldestPendingAgeMs: null,
  oldestRunningAgeMs: null,
  completedLast24h: 4,
  failedLast24h: 0,
  cancelledLast24h: 0,
  refusedLast24h: 0,
  targetFailedLast24h: 0,
};

function renderWith(databaseTls: unknown) {
  return render(
    <HealthOverview
      metrics={
        {
          scanQueue,
          generatedAt: new Date().toISOString(),
          ...(databaseTls === undefined ? {} : { databaseTls }),
        } as never
      }
      loading={false}
      refreshing={false}
      loadFailed={false}
      updateAvailable={false}
      onRefresh={vi.fn()}
      onNavigate={vi.fn()}
    />,
  );
}

afterEach(() => cleanup());

describe("HealthOverview: database TLS", () => {
  it("shows the warning as a warning alert when the payload carries one", () => {
    renderWith({ encrypted: false, remote: true, warning: WARNING });

    expect(screen.getByText(WARNING)).toBeTruthy();
    expect(
      screen.getByText("Database connection is not encrypted"),
    ).toBeTruthy();
  });

  it("counts it among the checks that need attention", () => {
    renderWith({ encrypted: false, remote: true, warning: WARNING });

    expect(screen.getByText(/1 check needs attention\./)).toBeTruthy();
    expect(screen.queryByText(/Nothing needs attention/)).toBeNull();
  });

  it("is a standing notice, not an announcement", () => {
    // It is true of the deployment from the moment the tab opens, so it must
    // not interrupt a screen reader the way the outcome of an action would.
    renderWith({ encrypted: false, remote: true, warning: WARNING });

    const alert = screen.getByText(WARNING).closest("[role='alert']");
    expect(alert).toBeNull();
  });

  it.each([
    ["encrypted", { encrypted: true, remote: true, warning: null }],
    ["local", { encrypted: false, remote: false, warning: null }],
    ["absent for this role", undefined],
    ["unknown", null],
  ])("renders no row when the database is %s", (_label, databaseTls) => {
    renderWith(databaseTls);

    expect(
      screen.queryByText("Database connection is not encrypted"),
    ).toBeNull();
    expect(
      screen.getByText(/Nothing needs attention right now\./),
    ).toBeTruthy();
  });
});
