import { describe, it, expect, vi } from "vitest";

import {
  attachBeforeUnloadWarning,
  type UnloadEventTarget,
  type UnloadLikeEvent,
} from "@/components/admin/shared/use-unsaved-changes-warning";

function fakeWindow() {
  const listeners = new Map<string, (event: UnloadLikeEvent) => void>();
  const addEventListener = vi.fn(
    (type: string, handler: (event: UnloadLikeEvent) => void) => {
      listeners.set(type, handler);
    },
  );
  const removeEventListener = vi.fn((type: string) => {
    listeners.delete(type);
  });
  const target: UnloadEventTarget = { addEventListener, removeEventListener };
  return { target, addEventListener, removeEventListener, listeners };
}

function fakeEvent() {
  const preventDefault = vi.fn();
  const event: UnloadLikeEvent = { preventDefault, returnValue: undefined };
  return { event, preventDefault };
}

describe("attachBeforeUnloadWarning", () => {
  it("registers exactly one beforeunload listener", () => {
    const { target, addEventListener } = fakeWindow();
    attachBeforeUnloadWarning(target, () => true);

    expect(addEventListener).toHaveBeenCalledTimes(1);
    expect(addEventListener).toHaveBeenCalledWith(
      "beforeunload",
      expect.any(Function),
    );
  });

  it("prevents default and sets returnValue when shouldWarn is true", () => {
    const { target, listeners } = fakeWindow();
    attachBeforeUnloadWarning(target, () => true);
    const handler = listeners.get("beforeunload")!;
    const { event, preventDefault } = fakeEvent();

    handler(event);

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(event.returnValue).toBe("");
  });

  it("does nothing when shouldWarn is false", () => {
    const { target, listeners } = fakeWindow();
    attachBeforeUnloadWarning(target, () => false);
    const handler = listeners.get("beforeunload")!;
    const { event, preventDefault } = fakeEvent();

    handler(event);

    expect(preventDefault).not.toHaveBeenCalled();
    expect(event.returnValue).toBeUndefined();
  });

  it("re-evaluates shouldWarn on every call rather than capturing its first value", () => {
    let warn = false;
    const { target, listeners } = fakeWindow();
    attachBeforeUnloadWarning(target, () => warn);
    const handler = listeners.get("beforeunload")!;

    const first = fakeEvent();
    handler(first.event);
    expect(first.preventDefault).not.toHaveBeenCalled();

    warn = true;
    const second = fakeEvent();
    handler(second.event);
    expect(second.preventDefault).toHaveBeenCalledTimes(1);
  });

  it("the returned cleanup removes the exact handler that was added", () => {
    const { target, listeners, removeEventListener } = fakeWindow();
    const cleanup = attachBeforeUnloadWarning(target, () => true);
    const handler = listeners.get("beforeunload")!;

    cleanup();

    expect(removeEventListener).toHaveBeenCalledTimes(1);
    expect(removeEventListener).toHaveBeenCalledWith("beforeunload", handler);
  });
});
