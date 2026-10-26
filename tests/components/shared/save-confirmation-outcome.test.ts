/**
 * SaveConfirmationModal used to drop the error it was handed. `onConfirm` is
 * typed to return `{ ok: boolean; error?: string }` and callers throw too, but
 * the modal only checked `ok === false` and went back to its form, so a failed
 * save looked like nothing had happened: on /profile the reason landed in a
 * banner under the dialog's scrim.
 *
 * The decision is in components/shared/save-confirmation-outcome.ts (no DOM in
 * this suite, so it is exercised as plain functions); the render is checked at
 * the source, and was also run in a real browser against Radix: `{ ok: false,
 * error }` and a thrown Error both put the message in a role="alert" inside the
 * dialog, the form stays, the error clears on cancel and reopen, and the
 * success state keeps an accessible name.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  SAVE_FAILED_MESSAGE,
  saveFailureMessage,
  saveThrownMessage,
} from "@/components/shared/save-confirmation-outcome";

describe("saveFailureMessage", () => {
  it("is null for a save that went through", () => {
    expect(saveFailureMessage({ ok: true })).toBeNull();
  });

  it("is null for a void return: callers that throw on failure return nothing", () => {
    expect(saveFailureMessage(undefined)).toBeNull();
  });

  it("carries the caller's error through", () => {
    expect(saveFailureMessage({ ok: false, error: "Email is taken." })).toBe(
      "Email is taken.",
    );
  });

  it("says something even when the caller gave no reason", () => {
    expect(saveFailureMessage({ ok: false })).toBe(SAVE_FAILED_MESSAGE);
    expect(saveFailureMessage({ ok: false, error: "   " })).toBe(
      SAVE_FAILED_MESSAGE,
    );
  });
});

describe("saveThrownMessage", () => {
  it("uses the thrown Error's message", () => {
    expect(saveThrownMessage(new Error("Server said no"))).toBe(
      "Server said no",
    );
  });

  it("falls back for an empty message or something that is not an Error", () => {
    expect(saveThrownMessage(new Error(""))).toBe(SAVE_FAILED_MESSAGE);
    expect(saveThrownMessage("boom")).toBe(SAVE_FAILED_MESSAGE);
    expect(saveThrownMessage(undefined)).toBe(SAVE_FAILED_MESSAGE);
  });

  it("does not use an em dash in the fallback (UI copy rule)", () => {
    expect(SAVE_FAILED_MESSAGE).not.toContain("—");
  });
});

describe("SaveConfirmationModal renders it", () => {
  const src = readFileSync(
    join(process.cwd(), "components/shared/save-confirmation-modal.tsx"),
    "utf8",
  );

  it("shows the error inside the dialog, above the buttons, as an error alert", () => {
    const alert = src.indexOf('<InlineAlert tone="error">{errorMessage}');
    expect(alert).toBeGreaterThan(-1);
    expect(alert).toBeLessThan(src.indexOf("<AlertDialogFooter>"));
  });

  it("feeds both failure shapes into that state", () => {
    expect(src).toContain("saveFailureMessage(result)");
    expect(src).toContain("saveThrownMessage(err)");
    // The silent catch it replaced.
    expect(src).not.toMatch(/catch\s*\{\s*\/\/ Error handling is done/);
  });

  it("clears a stale error on retry, close and reopen", () => {
    expect(
      src.match(/setErrorMessage\(null\)/g)?.length,
    ).toBeGreaterThanOrEqual(3);
  });

  it("keeps a title in the success state so the dialog keeps its name", () => {
    const success = src.slice(
      src.indexOf("{success ? ("),
      src.indexOf(") : ("),
    );
    expect(success).toContain("<AlertDialogTitle");
    expect(success).toContain("Changes Saved");
  });
});
