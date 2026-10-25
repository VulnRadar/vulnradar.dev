import { describe, it, expect, vi, afterEach } from "vitest";
import { logError } from "@/lib/logging/log";

/**
 * logError's whole job is the argument shape console.error receives, because
 * that shape decides what lib/database/error-log-capture.ts stores: a stack
 * only when an argument IS an Error, and only the first 2,000 characters of
 * the joined message.
 */
describe("logError", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("passes the Error object itself, never its message", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const err = new Error("connection terminated");
    logError("scan", "scan failed", err, { scanId: 12 });
    const args = spy.mock.calls[0];
    expect(args[args.length - 1]).toBe(err);
  });

  it("puts the scope tag and the context ahead of the error", () => {
    // Context first, so it survives the capture's message cut even when a
    // long stack does not.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const err = new Error("boom");
    logError("billing", "webhook unmatched", err, {
      userId: 4,
      eventId: "evt_1",
    });
    expect(spy.mock.calls[0]).toEqual([
      "[billing] webhook unmatched",
      { userId: 4, eventId: "evt_1" },
      err,
    ]);
  });

  it("drops undefined context entries, and an empty context entirely", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logError("email", "send failed", undefined, {
      template: "welcome",
      messageId: undefined,
    });
    logError("email", "send failed", undefined, { messageId: undefined });
    expect(spy.mock.calls[0]).toEqual([
      "[email] send failed",
      { template: "welcome" },
    ]);
    expect(spy.mock.calls[1]).toEqual(["[email] send failed"]);
  });

  it("passes a non-Error throw through unchanged", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logError("ai-chat", "provider rejected", { status: 429 });
    expect(spy.mock.calls[0]).toEqual([
      "[ai-chat] provider rejected",
      { status: 429 },
    ]);
  });
});
