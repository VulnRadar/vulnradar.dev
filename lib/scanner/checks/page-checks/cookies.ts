/**
 * Per-cookie flag audit.
 *
 * The legacy `cookie-security` detector (`checks/headers.ts`) joins every
 * missing attribute across every cookie into one semicolon-separated string:
 * "sid missing HttpOnly; sid missing Secure; theme missing SameSite". A user
 * cannot tell from that sentence which cookie is a session token and which is
 * a UI preference, or paste one line into a bug report. These checks read
 * `ctx.cookies` (parsed per Set-Cookie header by `parseSetCookie` in
 * `page-context.ts`) and attach one evidence excerpt per offending cookie, so
 * each cookie's own raw Set-Cookie value is the proof.
 */

import type { PageCheck } from "../../check-types";
import { excerpt } from "../../check-types";
import type { CookieInfo } from "../../page-context";

function label(c: CookieInfo): string {
  return c.sessionLike ? `${c.name} (session-like)` : c.name;
}

export const cookieChecks: PageCheck[] = [
  {
    id: "page-cookie-missing-secure",
    title: "Cookie missing the Secure attribute",
    category: "cookies",
    severity: "medium",
    method: "cookie-attribute",
    description:
      "One or more cookies are set without the Secure attribute on an HTTPS response.",
    riskImpact:
      "A cookie without Secure can be sent over a plaintext HTTP connection if the site or browser ever falls back to one, exposing it to network interception.",
    explanation:
      "The Secure attribute instructs the browser to only send the cookie over HTTPS connections.",
    fixSteps: [
      "Add the Secure attribute to every Set-Cookie header.",
      "Prefer the __Host- prefix, which requires Secure and a root path.",
    ],
    codeExamples: [
      {
        label: "Secure cookie",
        language: "http",
        code: "Set-Cookie: session=abc123; Secure; HttpOnly; SameSite=Lax; Path=/",
      },
    ],
    needs: ["cookies", "https"],
    dedupeGroup: "cookie-missing-secure",
    run(ctx) {
      const offending = ctx.cookies.filter((c) => !c.secure);
      if (offending.length === 0) return null;
      return {
        evidence: `${offending.length} of ${ctx.cookies.length} cookie(s) missing Secure: ${offending.map(label).join(", ")}.`,
        excerpts: offending.map((c) => excerpt("Set-Cookie", c.raw)),
        severity: offending.some((c) => c.sessionLike) ? "high" : "medium",
      };
    },
  },

  {
    id: "page-cookie-missing-httponly",
    title: "Session-like cookie missing the HttpOnly attribute",
    category: "cookies",
    severity: "high",
    method: "cookie-attribute",
    description:
      "A cookie whose name suggests it carries a session or auth token is set without HttpOnly.",
    riskImpact:
      "Without HttpOnly, any script running on the page (including one injected via XSS) can read the cookie's value with document.cookie and exfiltrate it.",
    explanation:
      "HttpOnly hides a cookie from JavaScript's document.cookie API entirely. It is checked only for names that look session-related (session, sid, auth, token, jwt, and similar) to avoid flagging cookies that are deliberately client-readable, like a theme preference.",
    fixSteps: [
      "Add the HttpOnly attribute to session and authentication cookies.",
    ],
    codeExamples: [],
    needs: ["cookies"],
    dedupeGroup: "cookie-missing-httponly",
    run(ctx) {
      const offending = ctx.cookies.filter(
        (c) => c.sessionLike && !c.httpOnly && c.prefix !== "__Host-",
      );
      if (offending.length === 0) return null;
      return {
        evidence: `${offending.length} session-like cookie(s) missing HttpOnly: ${offending.map((c) => c.name).join(", ")}.`,
        excerpts: offending.map((c) => excerpt("Set-Cookie", c.raw)),
      };
    },
  },

  {
    id: "page-cookie-missing-samesite",
    title: "Cookie missing the SameSite attribute",
    category: "cookies",
    severity: "low",
    method: "cookie-attribute",
    description:
      "One or more cookies are set without a SameSite attribute, so the browser applies its default (Lax in current browsers, but this varies by age and configuration).",
    riskImpact:
      "Without an explicit SameSite value, cookie behavior on cross-site navigations and requests depends on browser defaults rather than a deliberate policy, which is a weaker CSRF defense than declaring it.",
    explanation:
      "SameSite controls whether a cookie is sent on cross-site requests. Explicit Strict or Lax is a stronger, more auditable defense than relying on the browser default.",
    fixSteps: [
      "Add SameSite=Lax (or Strict for the most sensitive cookies) to every Set-Cookie header.",
    ],
    codeExamples: [],
    needs: ["cookies"],
    dedupeGroup: "cookie-missing-samesite",
    run(ctx) {
      const offending = ctx.cookies.filter((c) => c.sameSite === null);
      if (offending.length === 0) return null;
      return {
        evidence: `${offending.length} of ${ctx.cookies.length} cookie(s) missing SameSite: ${offending.map(label).join(", ")}.`,
        excerpts: offending.map((c) => excerpt("Set-Cookie", c.raw)),
      };
    },
  },

  {
    id: "page-cookie-samesite-none-without-secure",
    title: "Cookie sets SameSite=None without Secure",
    category: "cookies",
    severity: "high",
    method: "cookie-attribute",
    description:
      "A cookie sets SameSite=None but omits Secure, which modern browsers reject entirely.",
    riskImpact:
      "Chrome, Firefox and Edge silently drop a SameSite=None cookie that lacks Secure, so the cookie will not be set for any user on a current browser.",
    explanation:
      "The SameSite=None value is meant for cookies that intentionally need to be sent on cross-site requests (embedded widgets, cross-site iframes). Since 2020, browsers require Secure whenever SameSite=None is used.",
    fixSteps: ["Add the Secure attribute alongside SameSite=None."],
    codeExamples: [],
    references: [
      "https://developer.chrome.com/blog/samesite-cookies-explained",
    ],
    needs: ["cookies"],
    dedupeGroup: "cookie-samesite-none-no-secure",
    run(ctx) {
      const offending = ctx.cookies.filter(
        (c) => c.sameSite === "none" && !c.secure,
      );
      if (offending.length === 0) return null;
      return {
        evidence: `${offending.length} cookie(s) set SameSite=None without Secure: ${offending.map((c) => c.name).join(", ")}.`,
        excerpts: offending.map((c) => excerpt("Set-Cookie", c.raw)),
      };
    },
  },

  {
    id: "page-cookie-host-prefix-violation",
    title: "Cookie uses __Host- or __Secure- prefix incorrectly",
    category: "cookies",
    severity: "medium",
    method: "cookie-attribute",
    description:
      "A cookie name uses the __Host- or __Secure- prefix but does not meet the attribute requirements the prefix promises.",
    riskImpact:
      "Browsers enforce these prefixes: a violating Set-Cookie header is rejected outright, so the cookie silently fails to be set for every user.",
    explanation:
      "__Secure- requires the Secure attribute. __Host- additionally requires Path=/ and forbids a Domain attribute, which pins the cookie to the exact host that set it.",
    fixSteps: [
      "For __Secure- cookies, ensure Secure is set.",
      "For __Host- cookies, ensure Secure is set, Path is '/', and no Domain attribute is present.",
    ],
    codeExamples: [],
    references: [
      "https://developer.mozilla.org/en-US/docs/Web/HTTP/Cookies#cookie_prefixes",
    ],
    needs: ["cookies"],
    dedupeGroup: "cookie-prefix-violation",
    run(ctx) {
      const offending = ctx.cookies.filter((c) => {
        if (c.prefix === "__Secure-") return !c.secure;
        if (c.prefix === "__Host-")
          return !c.secure || c.path !== "/" || c.domain !== null;
        return false;
      });
      if (offending.length === 0) return null;
      return {
        evidence: `${offending.length} cookie(s) violate their name prefix's requirements: ${offending.map((c) => c.name).join(", ")}.`,
        excerpts: offending.map((c) => excerpt("Set-Cookie", c.raw)),
      };
    },
  },

  {
    id: "page-cookie-session-missing-host-prefix",
    title: "Session-like cookie does not use the __Host- prefix",
    category: "cookies",
    severity: "low",
    method: "cookie-attribute",
    confidence: 60,
    description:
      "A cookie whose name looks like a session or auth token is set without the __Host- prefix, even though it already meets every requirement the prefix would enforce (Secure, Path=/, no Domain attribute).",
    riskImpact:
      "Without the prefix, nothing stops a future configuration change (adding a Domain attribute, narrowing the path) from quietly weakening the cookie's scope. The __Host- prefix makes the browser reject a misconfigured Set-Cookie header outright instead of relying on configuration discipline.",
    explanation:
      "This is a hardening recommendation, not a defect: adopting the prefix is a rename with no behavior change other than the browser-enforced guarantee. A cookie missing Secure, Path=/, or setting a Domain is reported by the __Host-/__Secure- prefix-violation check instead, not here.",
    fixSteps: [
      "Rename the cookie to start with __Host- (requires Secure, Path=/, and no Domain attribute, which this cookie already has).",
    ],
    codeExamples: [
      {
        label: "Host-prefixed session cookie",
        language: "http",
        code: "Set-Cookie: __Host-session=abc123; Secure; HttpOnly; SameSite=Lax; Path=/",
      },
    ],
    references: [
      "https://developer.mozilla.org/en-US/docs/Web/HTTP/Cookies#cookie_prefixes",
    ],
    needs: ["cookies", "https"],
    run(ctx) {
      const offending = ctx.cookies.filter(
        (c) =>
          c.sessionLike &&
          c.prefix === null &&
          c.secure &&
          c.path === "/" &&
          c.domain === null,
      );
      if (offending.length === 0) return null;
      return {
        evidence: `${offending.length} session-like cookie(s) qualify for the __Host- prefix but don't use it: ${offending.map((c) => c.name).join(", ")}.`,
        excerpts: offending.map((c) => excerpt("Set-Cookie", c.raw)),
      };
    },
  },

  {
    id: "page-cookie-session-samesite-none-review",
    title: "Session-like cookie explicitly allows cross-site sending",
    category: "cookies",
    severity: "medium",
    method: "cookie-attribute",
    confidence: 80,
    description:
      "A cookie whose name looks like a session or auth token sets SameSite=None, which sends it on cross-site requests, including ones initiated by a different site the user is visiting.",
    riskImpact:
      "SameSite=None is meant for cookies that must be attached to cross-site requests intentionally (an embedded widget's own backend calls). Applied to the main session cookie, it removes SameSite's cross-site request forgery mitigation entirely, so the application must rely solely on other CSRF defenses.",
    explanation:
      "This does not check whether Secure is also present; a SameSite=None cookie missing Secure is reported separately by the samesite-none-without-secure check. This one fires whenever a session-like cookie uses None, correctly configured or not, because the cross-site exposure itself is worth a second look.",
    fixSteps: [
      "Confirm this cookie genuinely needs to be sent cross-site (embedded in a third-party context).",
      "If not, change SameSite to Lax or Strict.",
      "If cross-site delivery is required, ensure a separate CSRF token or custom-header check protects state-changing requests.",
    ],
    codeExamples: [],
    needs: ["cookies"],
    run(ctx) {
      const offending = ctx.cookies.filter(
        (c) => c.sessionLike && c.sameSite === "none",
      );
      if (offending.length === 0) return null;
      return {
        evidence: `${offending.length} session-like cookie(s) set SameSite=None: ${offending.map((c) => c.name).join(", ")}.`,
        excerpts: offending.map((c) => excerpt("Set-Cookie", c.raw)),
      };
    },
  },
];
