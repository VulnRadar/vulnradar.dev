/**
 * Form security checks built on the parsed form/input structure.
 *
 * The legacy detectors in `checks/headers.ts` (`form-action-http`,
 * `form-no-action-https`, `sensitive-form-no-csrf`) regex the raw body for
 * `<form`/`<input` substrings, so markup that appears inside a JavaScript
 * string literal is indistinguishable from a real form (see the engine audit,
 * section 2). These checks read `ctx.forms`, which comes from the tokenizer
 * and resolves the form's action URL against the page URL, so they only fire
 * on forms that actually exist in the markup.
 */

import type { PageCheck } from "../../check-types";
import { excerpt } from "../../check-types";

export const formChecks: PageCheck[] = [
  {
    id: "page-form-password-over-http",
    title: "Password field submits over plain HTTP",
    category: "content",
    severity: "critical",
    method: "dom-structure",
    description:
      "A form containing a password field submits to an http:// URL, so credentials are sent unencrypted.",
    riskImpact:
      "Anyone on the network path between the browser and the server, or in control of an intermediate proxy, can read the submitted password in plaintext.",
    explanation:
      "The form's resolved action attribute uses the http scheme. Even when the page itself loads over HTTPS, the browser will submit this specific form over plain HTTP.",
    fixSteps: [
      "Change the form action to an https:// URL.",
      "Serve the entire site over HTTPS and redirect http:// to https://.",
    ],
    codeExamples: [],
    needs: ["forms"],
    dedupeGroup: "form-over-http",
    run(ctx) {
      const offending = ctx.forms.filter(
        (f) => f.passwordFields.length > 0 && f.submitsOverHttp,
      );
      if (offending.length === 0) return null;
      return {
        evidence: `${offending.length} form(s) with a password field submit over HTTP.`,
        excerpts: offending.map((f) =>
          excerpt("form action", f.resolvedAction ?? f.action ?? "(unset)"),
        ),
      };
    },
  },

  {
    id: "page-form-missing-csrf-token",
    title: "State-changing form has no visible anti-CSRF token",
    category: "content",
    severity: "medium",
    method: "dom-structure",
    confidence: 55,
    description:
      "A form that submits with POST, PUT, PATCH, or DELETE has no hidden field that looks like a CSRF token.",
    riskImpact:
      "Without a token the server must rely on another mechanism (SameSite cookies, custom headers checked server-side) to block cross-site submission; if it does not, an attacker's page can submit this form on a logged-in user's behalf.",
    explanation:
      "This is a heuristic: the check only sees the rendered HTML, not the server-side validation. Frameworks that verify a custom request header instead of a hidden field, or that rely solely on SameSite cookies, will trigger this without being vulnerable. Confidence is set low for that reason.",
    fixSteps: [
      "Include a per-session anti-CSRF token as a hidden form field and validate it server-side.",
      "If CSRF protection is enforced another way (double-submit cookie, custom header), confirm it applies to this form and disregard this finding.",
    ],
    codeExamples: [],
    references: ["https://owasp.org/www-community/attacks/csrf"],
    needs: ["forms"],
    dedupeGroup: "form-missing-csrf",
    run(ctx) {
      const mutating = ctx.forms.filter((f) =>
        ["post", "put", "patch", "delete"].includes(f.method),
      );
      const offending = mutating.filter((f) => f.csrfTokens.length === 0);
      if (offending.length === 0) return null;
      return {
        evidence: `${offending.length} of ${mutating.length} state-changing form(s) have no hidden CSRF-token-shaped field.`,
        excerpts: offending.map((f) =>
          excerpt(
            "form",
            `method=${f.method} action=${f.action ?? "(page URL)"}`,
          ),
        ),
      };
    },
  },

  {
    id: "page-form-cross-origin-action",
    title: "Form submits to a different origin than the page",
    category: "content",
    severity: "low",
    method: "dom-structure",
    confidence: 65,
    description:
      "A form's action attribute points at an origin other than the page serving it.",
    riskImpact:
      "Data entered into the form, including anything auto-filled by the browser, is sent to a third party. This is expected for hosted payment or newsletter widgets, but unexpected on a form that looks first-party.",
    explanation:
      "The resolved action URL's origin differs from the page's origin. This is common and legitimate for payment processors and embedded widgets, so it is reported at low severity and confidence rather than treated as a defect.",
    fixSteps: [
      "Confirm the third-party origin is an intended integration.",
      "If the form should stay first-party, correct the action attribute.",
    ],
    codeExamples: [],
    needs: ["forms"],
    run(ctx) {
      const offending = ctx.forms.filter(
        (f) => f.crossOrigin && f.passwordFields.length === 0,
      );
      if (offending.length === 0) return null;
      return {
        evidence: `${offending.length} form(s) submit to a third-party origin.`,
        excerpts: offending.map((f) =>
          excerpt("form action", f.resolvedAction ?? f.action ?? "(unset)"),
        ),
      };
    },
  },

  {
    id: "page-password-field-autocomplete-wrong",
    title: "Password field uses the wrong autocomplete token",
    category: "content",
    severity: "low",
    method: "dom-structure",
    confidence: 75,
    description:
      'A password input does not declare autocomplete="current-password" or autocomplete="new-password", so the browser cannot offer its built-in password manager integration or breach-checked new password generation.',
    riskImpact:
      "Not a direct vulnerability, but it degrades the browser and password manager's ability to warn about reused or breached passwords and to generate strong ones on signup.",
    explanation:
      'WHATWG HTML defines autocomplete="current-password" for login forms and autocomplete="new-password" for registration and password-change forms. autocomplete="off" or an absent attribute disables this integration.',
    fixSteps: [
      'Add autocomplete="current-password" to login password fields.',
      'Add autocomplete="new-password" to signup and password-change fields.',
    ],
    codeExamples: [
      {
        label: "Login field",
        language: "html",
        code: '<input type="password" name="password" autocomplete="current-password">',
      },
    ],
    needs: ["forms"],
    run(ctx) {
      const offending = ctx.forms.flatMap((f) =>
        f.passwordFields.filter(
          (p) =>
            p.autocomplete !== "current-password" &&
            p.autocomplete !== "new-password",
        ),
      );
      if (offending.length === 0) return null;
      return {
        evidence: `${offending.length} password field(s) missing autocomplete="current-password" or "new-password".`,
        excerpts: offending.map((p) => excerpt("input", p.raw)),
      };
    },
  },

  {
    id: "page-form-password-cross-origin",
    title: "Password field submits to a different origin than the page",
    category: "content",
    severity: "high",
    method: "dom-structure",
    confidence: 70,
    description:
      "A form containing a password field submits to an origin other than the one serving the page.",
    riskImpact:
      "The credential is sent directly to a third party rather than to the site the user believes they are logging into. This is expected for a small number of legitimate identity-provider integrations, but on a form that otherwise looks first-party, it is a strong phishing/credential-harvesting indicator, or at minimum a third-party dependency for handling raw passwords.",
    explanation:
      "The form's resolved action origin differs from the page origin, and the form contains at least one password field. `page-form-cross-origin-action` deliberately excludes forms with a password field to avoid double-reporting; this check exists specifically for that excluded case, because a cross-origin password submission is a materially different risk than a cross-origin newsletter signup. Legitimate cases include a hosted login widget (Auth0, Okta) deliberately posting to its own domain; confirm the third-party origin is an intended identity provider before treating this as a defect.",
    fixSteps: [
      "Confirm the third-party origin is a trusted, intended authentication provider.",
      "If not, correct the form action to submit to the site's own backend, or proxy the login request server-side.",
    ],
    codeExamples: [],
    needs: ["forms"],
    run(ctx) {
      const offending = ctx.forms.filter(
        (f) => f.crossOrigin && f.passwordFields.length > 0,
      );
      if (offending.length === 0) return null;
      return {
        evidence: `${offending.length} form(s) with a password field submit to a third-party origin.`,
        excerpts: offending.map((f) =>
          excerpt("form action", f.resolvedAction ?? f.action ?? "(unset)"),
        ),
      };
    },
  },
];
