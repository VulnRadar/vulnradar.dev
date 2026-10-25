import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * instrumentation.ts exports Next's onRequestError hook next to register().
 * Next calls it for every error nothing caught, in a route handler that is not
 * wrapped in withErrorHandling, a server component or a server action. The
 * work is in lib/logging/request-error.ts (tested on its own); what is pinned
 * here is that the hook exists, forwards its three arguments, and stays out of
 * the edge build, where node:async_hooks does not exist.
 */
const mockReport = vi.fn();
vi.mock("@/lib/logging/request-error", () => ({
  reportRequestError: (...args: unknown[]) => mockReport(...args),
}));

const originalRuntime = process.env.NEXT_RUNTIME;

beforeEach(() => {
  mockReport.mockReset();
});

afterEach(() => {
  if (originalRuntime === undefined) delete process.env.NEXT_RUNTIME;
  else process.env.NEXT_RUNTIME = originalRuntime;
});

const request = {
  path: "/api/v3/scan",
  method: "POST",
  headers: { "x-request-id": "d4e5f6a7-b8c9-4d0e-9f1a-3b4c5d6e7f80" },
};
const context = {
  routerKind: "App Router" as const,
  routePath: "/api/v3/scan",
  routeType: "route" as const,
  revalidateReason: undefined,
};

describe("instrumentation.ts: onRequestError", () => {
  it("is exported alongside register", async () => {
    const mod = await import("@/instrumentation");
    expect(typeof mod.onRequestError).toBe("function");
    expect(typeof mod.register).toBe("function");
  });

  it("hands the error, request and context to the reporter on the Node runtime", async () => {
    process.env.NEXT_RUNTIME = "nodejs";
    const { onRequestError } = await import("@/instrumentation");
    const err = new Error("boom");

    await onRequestError(err, request, context);

    expect(mockReport).toHaveBeenCalledWith(err, request, context);
  });

  it("does nothing on the edge runtime", async () => {
    // The dynamic import has to be dead code there: the reporter pulls in
    // node:async_hooks, and an edge bundle that reaches it does not build.
    process.env.NEXT_RUNTIME = "edge";
    const { onRequestError } = await import("@/instrumentation");

    await onRequestError(new Error("boom"), request, context);

    expect(mockReport).not.toHaveBeenCalled();
  });
});
