/**
 * computeAuthPresence decides what the browser should cache for a given
 * /api/v3/auth/me result. The regression this guards: a logged-out result
 * (a 401, which the fetcher turns into null, or a body with no userId) MUST
 * clear the cache + injected CSS, so a session revoked elsewhere ("Sign out
 * everywhere", an admin force-logout, another device, or plain expiry)
 * cannot leave this browser showing a signed-in shell on the next visit.
 * authPresenceSettled keeps a read that failed for another reason from
 * counting as logged out. Pure functions, so no DOM/jsdom is needed.
 */
import { describe, it, expect } from "vitest";
import {
  authPresenceSettled,
  computeAuthPresence,
  type AuthPresenceInput,
} from "@/lib/auth/auth-presence";

describe("authPresenceSettled", () => {
  it("acts on a user or on null, the fetcher's answer for a 401", () => {
    expect(authPresenceSettled({ userId: 7, role: "user" }, false)).toBe(true);
    expect(authPresenceSettled(null, false)).toBe(true);
  });

  it("does not act on a read still in flight", () => {
    expect(authPresenceSettled(undefined, true)).toBe(false);
    expect(authPresenceSettled(null, true)).toBe(false);
  });

  it("does not act on a first read that failed, which leaves me undefined", () => {
    // A 429, a 502 or a maintenance 503 on a fresh page load: the fetcher
    // throws, SWR has no earlier data to keep, and signing the shell out on
    // that showed Start free to someone who was signed in.
    expect(authPresenceSettled(undefined, false)).toBe(false);
  });
});

// The shape /me actually returns when the session is gone: ApiResponse
// .unauthorized() => a JSON body with no userId. The SWR fetcher parses it
// into `me`, so `me` is a truthy object that must still read as logged out.
const LOGGED_OUT_BODY = {
  success: false,
  error: "Authentication required",
} as unknown as AuthPresenceInput;

describe("computeAuthPresence", () => {
  it("clears the cache and both flags when /me reports logged out (401 body with no userId)", () => {
    expect(computeAuthPresence(LOGGED_OUT_BODY)).toEqual({
      cache: null,
      auth: false,
      staff: false,
    });
  });

  it("clears the cache and both flags when /me is null (a 401) or undefined", () => {
    const cleared = { cache: null, auth: false, staff: false };
    expect(computeAuthPresence(null)).toEqual(cleared);
    expect(computeAuthPresence(undefined)).toEqual(cleared);
  });

  it("caches the user and reveals auth-only UI when signed in", () => {
    const me = {
      userId: 7,
      role: "user",
      email: "a@b.c",
    } as unknown as AuthPresenceInput;
    const { cache, auth, staff } = computeAuthPresence(me);
    expect(cache).toBe(JSON.stringify(me));
    expect(auth).toBe(true);
    expect(staff).toBe(false);
  });

  it("reveals staff-only UI for a staff role", () => {
    const { auth, staff } = computeAuthPresence({
      userId: 1,
      role: "admin",
    } as unknown as AuthPresenceInput);
    expect(auth).toBe(true);
    expect(staff).toBe(true);
  });

  it("returns flags, never a stylesheet", () => {
    // The regression this guards: a css string here existed only so the
    // pre-hydration script could build a <style> element and append it to
    // document.head. Appending to the head before React hydrates made React
    // treat the markup as mismatched and regenerate the tree on the client,
    // which replayed every route's loading.tsx over the page's own skeleton.
    // Reintroducing a stylesheet here would bring that back.
    const out = computeAuthPresence({
      userId: 1,
      role: "admin",
    } as unknown as AuthPresenceInput);
    expect(out).not.toHaveProperty("css");
    // No returned value may be a CSS rule: the flags are booleans and the
    // cache is the verbatim /me JSON, so nothing here should carry a selector.
    for (const value of Object.values(out)) {
      if (typeof value === "string") {
        expect(value).not.toMatch(/.vr-|!important|{s*[a-z-]+s*:/);
      }
    }
  });
});
