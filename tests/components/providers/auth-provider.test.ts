/**
 * computeAuthPresence decides what the browser should cache for a given
 * /api/v3/auth/me result. The regression this guards: a logged-out result
 * (a 401 body with no userId, or a null/undefined me from a failed fetch)
 * MUST clear the cache + injected CSS, so a session revoked elsewhere
 * ("Sign out everywhere", an admin force-logout, another device, or plain
 * expiry) cannot leave this browser showing a signed-in shell on the next
 * visit. Pure function, so no DOM/jsdom is needed.
 */
import { describe, it, expect } from "vitest";
import {
  computeAuthPresence,
  type AuthPresenceInput,
} from "@/lib/auth/auth-presence";

// The shape /me actually returns when the session is gone: ApiResponse
// .unauthorized() => a JSON body with no userId. The SWR fetcher parses it
// into `me`, so `me` is a truthy object that must still read as logged out.
const LOGGED_OUT_BODY = {
  success: false,
  error: "Authentication required",
} as unknown as AuthPresenceInput;

describe("computeAuthPresence", () => {
  it("clears the cache and CSS when /me reports logged out (401 body with no userId)", () => {
    expect(computeAuthPresence(LOGGED_OUT_BODY)).toEqual({
      cache: null,
      css: "",
    });
  });

  it("clears the cache and CSS when /me is null/undefined (fetch failed)", () => {
    expect(computeAuthPresence(null)).toEqual({ cache: null, css: "" });
    expect(computeAuthPresence(undefined)).toEqual({ cache: null, css: "" });
  });

  it("caches the user and reveals auth-only UI when signed in", () => {
    const me = {
      userId: 7,
      role: "user",
      email: "a@b.c",
    } as unknown as AuthPresenceInput;
    const { cache, css } = computeAuthPresence(me);
    expect(cache).toBe(JSON.stringify(me));
    expect(css).toContain("vr-auth-only");
    expect(css).not.toContain("vr-staff-only");
  });

  it("reveals staff-only UI for a staff role", () => {
    const { css } = computeAuthPresence({
      userId: 1,
      role: "admin",
    } as unknown as AuthPresenceInput);
    expect(css).toContain("vr-auth-only");
    expect(css).toContain("vr-staff-only");
  });
});
