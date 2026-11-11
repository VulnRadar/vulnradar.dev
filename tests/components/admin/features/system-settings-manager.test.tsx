// @vitest-environment jsdom
/**
 * Saving and importing system settings when a request fails part way.
 *
 * Each key is its own request. A dropped connection on one of them threw out
 * of the loop, past the `setSaving(false)` / `setImporting(false)` after it,
 * so Save, Discard and the import dialog's buttons stayed disabled until a
 * reload, and the keys that had already saved were never marked as saved,
 * which invited sending the same values again.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";

const { SystemSettingsManager, saveSettingsOneByOne } =
  await import("@/components/admin/features/system-settings-manager");

describe("saveSettingsOneByOne", () => {
  it("keeps going past a request that throws and reports what saved", async () => {
    const call = vi.fn(async (body: Record<string, unknown>) => {
      if (body.key === "ENFORCE_STAFF_2FA") throw new TypeError("offline");
      if (body.key === "FEATURE_SCHEDULED_SCANS")
        return { ok: false, data: { error: "Refused." } };
      return { ok: true, data: {} };
    });

    const outcome = await saveSettingsOneByOne(
      [
        ["SCHEDULED_BACKUP_ENABLED", true],
        ["ENFORCE_STAFF_2FA", true],
        ["FEATURE_SCHEDULED_SCANS", false],
      ],
      call,
      "save",
    );

    expect(call).toHaveBeenCalledTimes(3);
    expect(outcome.saved).toEqual(["SCHEDULED_BACKUP_ENABLED"]);
    expect(outcome.failures).toEqual([
      "Could not reach the server to save ENFORCE_STAFF_2FA. Check the connection and try again.",
      "Refused.",
    ]);
  });

  it("sends the set action for each key with its value", async () => {
    const call = vi.fn(async () => ({ ok: true, data: {} }));
    await saveSettingsOneByOne([["ENFORCE_STAFF_2FA", true]], call, "import");
    expect(call).toHaveBeenCalledWith({
      section: "system_settings",
      action: "set",
      key: "ENFORCE_STAFF_2FA",
      value: true,
    });
  });
});

describe("importing settings when one request drops", () => {
  const sets: string[] = [];

  beforeEach(() => {
    sets.length = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body ?? "{}"));
        if (body.action === "effective") {
          return new Response(
            JSON.stringify({ effective: {}, overridden: [], secretsSet: [] }),
            { status: 200 },
          );
        }
        sets.push(body.key);
        if (body.key === "ENFORCE_STAFF_2FA") throw new TypeError("offline");
        return new Response("{}", { status: 200 });
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("frees the dialog, keeps it open with the reason, and leaves only the failed key to retry", async () => {
    const { container } = render(<SystemSettingsManager />);
    await waitFor(() =>
      expect(screen.queryByLabelText("Search settings")).not.toBeNull(),
    );

    const input = container.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    const file = new File(
      [
        JSON.stringify({
          ENFORCE_STAFF_2FA: true,
          SCHEDULED_BACKUP_ENABLED: true,
        }),
      ],
      "settings.json",
      { type: "application/json" },
    );
    fireEvent.change(input, { target: { files: [file] } });

    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(
      within(dialog).getByRole("button", { name: /Import settings/ }),
    );

    await within(dialog).findByText(/Could not reach the server to import/);
    expect(sets.sort()).toEqual([
      "ENFORCE_STAFF_2FA",
      "SCHEDULED_BACKUP_ENABLED",
    ]);
    // Not stuck busy: the confirm button can be pressed again.
    const retry = within(dialog).getByRole("button", {
      name: /Import settings/,
    }) as HTMLButtonElement;
    expect(retry.disabled).toBe(false);

    // The retry sends only the key that did not go through.
    sets.length = 0;
    fireEvent.click(retry);
    await waitFor(() => expect(sets).toEqual(["ENFORCE_STAFF_2FA"]));
  });
});
