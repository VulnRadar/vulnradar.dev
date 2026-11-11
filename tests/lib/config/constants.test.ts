import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  ERROR_MESSAGES,
  PASSWORD_MIN_LENGTH,
  API,
  API_CURRENT_VERSION,
} from "@/lib/config/constants";
import { PUBLIC_PATHS } from "@/lib/config/public-paths";
import { isLegacyPublicApi } from "@/lib/api/route-registry";

/**
 * The four functions in lib/config/constants.ts, as opposed to its several
 * hundred plain values.
 *
 * They are here because every one of them had already shipped wrong once, in
 * the same way: a message that states a number, written next to the constant
 * that holds the real number, and nothing comparing the two. WEAK_PASSWORD
 * said "at least 8 characters" four lines below the export that sets the
 * minimum to 12. TOO_MANY_ATTEMPTS_MINUTES is the correct version of a sentence that
 * thirty-one routes still reimplement inline, every one of them printing the
 * literal "1 minute(s)". Values cannot drift like that on their own; the
 * functions can, so the functions get the tests.
 */
describe("ERROR_MESSAGES.WEAK_PASSWORD", () => {
  it("states the minimum it is given rather than a baked-in number", () => {
    expect(ERROR_MESSAGES.WEAK_PASSWORD(12)).toBe(
      "Password must be at least 12 characters long.",
    );
    expect(ERROR_MESSAGES.WEAK_PASSWORD(20)).toBe(
      "Password must be at least 20 characters long.",
    );
  });

  it("agrees with PASSWORD_MIN_LENGTH when handed it", () => {
    // The regression that made this a function: the old flat string said 8
    // while PASSWORD_MIN_LENGTH was 12, so a caller would have told the user
    // a rule the signup form does not enforce.
    expect(ERROR_MESSAGES.WEAK_PASSWORD(PASSWORD_MIN_LENGTH)).toContain(
      `at least ${PASSWORD_MIN_LENGTH} characters`,
    );
    expect(ERROR_MESSAGES.WEAK_PASSWORD(PASSWORD_MIN_LENGTH)).not.toContain(
      "at least 8 characters",
    );
  });
});

describe("ERROR_MESSAGES.TOO_MANY_ATTEMPTS_MINUTES", () => {
  it("cannot be mistaken for the helper that takes seconds", () => {
    expect(ERROR_MESSAGES).not.toHaveProperty("TOO_MANY_ATTEMPTS");
  });

  it("says 'minute' for one and 'minutes' for more than one", () => {
    // This is the whole reason the shared helper exists. The inline copies
    // scattered through the routes print "Please try again in 1 minute(s)."
    expect(ERROR_MESSAGES.TOO_MANY_ATTEMPTS_MINUTES("login attempts", 1)).toBe(
      "Too many login attempts. Please wait 1 minute before trying again.",
    );
    expect(ERROR_MESSAGES.TOO_MANY_ATTEMPTS_MINUTES("login attempts", 5)).toBe(
      "Too many login attempts. Please wait 5 minutes before trying again.",
    );
    expect(
      ERROR_MESSAGES.TOO_MANY_ATTEMPTS_MINUTES("login attempts", 1),
    ).not.toContain("minute(s)");
  });

  it("takes the whole noun phrase and does not append a word of its own", () => {
    // The regression this pins: the template used to append a literal
    // " attempts", while all four live callers already passed a phrase
    // ending in it, so users on the forgot-password and signup limits read
    // "Too many reset attempts attempts." It also has to work for the
    // rate limits that are not attempts at anything.
    expect(ERROR_MESSAGES.TOO_MANY_ATTEMPTS_MINUTES("reset attempts", 5)).toBe(
      "Too many reset attempts. Please wait 5 minutes before trying again.",
    );
    expect(
      ERROR_MESSAGES.TOO_MANY_ATTEMPTS_MINUTES("reset attempts", 5),
    ).not.toContain("attempts attempts");
    expect(ERROR_MESSAGES.TOO_MANY_ATTEMPTS_MINUTES("AI requests", 2)).toBe(
      "Too many AI requests. Please wait 2 minutes before trying again.",
    );
  });
});

describe("ERROR_MESSAGES.REQUIRED_FIELD", () => {
  it("names the field", () => {
    expect(ERROR_MESSAGES.REQUIRED_FIELD("Email")).toBe("Email is required.");
  });
});

// Asserted against `API` rather than the old API_V3 map. API_V3 was a second,
// fully hardcoded copy of the same routes and has been deleted; `API` is the
// one built from API_VERSION, so these assertions are now checking the map
// that callers actually use (AUDIT-014#hc-10).
describe("API.SCAN_DISCOVER_PROGRESS", () => {
  it("builds the progress path under the same version prefix as its siblings", () => {
    expect(API.SCAN_DISCOVER_PROGRESS("abc123")).toBe(
      "/api/v3/scan/discover/progress/abc123",
    );
    // The point of building routes from one map is that they cannot drift
    // apart. API_CURRENT_VERSION is the single declaration of "v3"; a path
    // that stopped matching it would be a route the client asks for and the
    // server does not serve.
    expect(API.SCAN_DISCOVER_PROGRESS("abc123")).toContain(
      `/api/${API_CURRENT_VERSION}/`,
    );
    expect(API.SCAN_DISCOVER_PROGRESS("abc123")).toContain(API.SCAN_DISCOVER);
  });

  it("encodes the id it is given, so a url-unsafe one stays one segment", () => {
    // The map encodes, so callers pass the raw id and never encode it
    // themselves (tests/repo/history-paths-encoded.test.ts).
    expect(API.SCAN_DISCOVER_PROGRESS("a/b")).toBe(
      "/api/v3/scan/discover/progress/a%2Fb",
    );
  });
});

// Which API routes need no session is the route registry's question now
// (PUBLIC_PATHS holds pages only). While the v3 files have not moved, the
// registry decides them with the 3.9.1 prefixes in LEGACY_PUBLIC_API, so this
// asserts that the routes the web app calls signed out are still on it: a
// missing one is answered with a 401 instead of the handler.
describe("the API map's public routes stay anonymous", () => {
  it("are on the legacy public list", () => {
    for (const route of [
      API.AUTH.LOGIN,
      API.AUTH.SIGNUP,
      API.AUTH.TWO_FA.VERIFY,
      API.DEMO_SCAN,
      API.CONTACT,
      API.FINDING_TYPES,
      // The language switcher. Anyone can change the language, signed in or
      // not: the route sets the cookie rendering reads for everybody and only
      // writes users.locale when there is a session. Left out, its PUT 307'd
      // to /login, fetch followed the redirect, and the site quietly stayed in
      // English.
      API.ACCOUNT_LANGUAGE,
    ]) {
      expect(isLegacyPublicApi(route), route).toBe(true);
      expect(PUBLIC_PATHS).not.toContain(route);
    }
  });

  it("does not allowlist the landing-contact relay it replaced with nothing", () => {
    // /api/v3/landing-contact took an unauthenticated email and message and
    // mailed a confirmation back to whatever address was typed, from the
    // product's own domain. Nothing called it. The route is deleted; this
    // keeps it, and its public-path entry, from quietly coming back.
    expect(PUBLIC_PATHS.some((path) => path.includes("landing-contact"))).toBe(
      false,
    );
    expect(
      existsSync(join(process.cwd(), "app/api/v3/landing-contact/route.ts")),
    ).toBe(false);
  });

  it("carries no entry with a fragment or query, which a pathname match can never hit", () => {
    // ROUTES.GDPR_REQUEST ("/legal/privacy#gdpr") was listed here and was
    // dead for exactly this reason. The "/legal" prefix entry covers it.
    for (const path of PUBLIC_PATHS) {
      expect(path).not.toMatch(/[#?]/);
    }
  });
});
