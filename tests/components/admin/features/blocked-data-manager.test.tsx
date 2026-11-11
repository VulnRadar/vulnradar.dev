// @vitest-environment jsdom
/**
 * The blocked-data purge quotes the number it will delete, not the length of
 * the list it shows.
 *
 * bug-ui-admin-4: the search lists the 100 most recent matches and the delete
 * removes every match across every account, and the confirm said "100 scans"
 * in front of a delete that took 4,000. The only safeguard understated the
 * blast radius.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";

const { BlockedDataManager, readScanMatches, scanListFootnote } =
  await import("@/components/admin/features/blocked-data-manager");

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function scans(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    url: `https://evil.example.test/${i}`,
    source: "manual",
    scanned_at: "2026-10-01T10:00:00Z",
    user_id: 1,
    user_email: "a@example.com",
  }));
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("readScanMatches", () => {
  it("takes the server's total and truncated flag", () => {
    expect(
      readScanMatches({ scans: scans(100), total: 150, truncated: true }),
    ).toMatchObject({ total: 150, truncated: true });
  });

  it("reads a response with no total as the list being everything", () => {
    expect(readScanMatches({ scans: scans(3) })).toMatchObject({
      total: 3,
      truncated: false,
    });
  });

  it("never reports a total below what it lists", () => {
    expect(readScanMatches({ scans: scans(4), total: 2 })).toMatchObject({
      total: 4,
      truncated: false,
    });
  });
});

describe("scanListFootnote", () => {
  it("says how much of the total is on screen when the list is cut", () => {
    expect(
      scanListFootnote({
        scans: scans(100),
        total: 150,
        truncated: true,
      }),
    ).toBe("Showing the 100 most recent of 150. Deleting removes all 150.");
  });

  it("is the plain total otherwise", () => {
    expect(
      scanListFootnote({
        scans: scans(1),
        total: 1,
        truncated: false,
      }),
    ).toBe("1 scan total. Scroll to view all.");
  });
});

describe("the free-form lookup", () => {
  it("shows the exact total and confirms the delete with it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body ?? "{}"));
        if (String(url).endsWith("/features")) return json({ rules: [] });
        if (body.action === "find_scans") {
          return json({ scans: scans(100), total: 150, truncated: true });
        }
        throw new Error(`unexpected ${body.action}`);
      }),
    );
    render(<BlockedDataManager />);

    fireEvent.change(screen.getByLabelText("Host or URL to look up"), {
      target: { value: "evil.example.test" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    expect(
      await screen.findByText(
        "Showing the 100 most recent of 150. Deleting removes all 150.",
      ),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Delete all scans/ }));
    const dialog = await screen.findByRole("alertdialog");
    expect(
      within(dialog).getByText(/permanently delete 150 scans of history/),
    ).toBeTruthy();
    expect(within(dialog).getByText("150 scans")).toBeTruthy();
  });
});
