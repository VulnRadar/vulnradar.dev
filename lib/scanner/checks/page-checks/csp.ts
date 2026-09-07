/**
 * CSP checks built on the parsed directive map instead of regex over the raw
 * header string.
 *
 * The regex-based legacy CSP checks in `checks/headers.ts` match each
 * directive independently, so `csp-frame-src-missing` fires on
 * `default-src 'none'` even though `frame-src` correctly falls back to it --
 * a measured false positive. These checks read `ctx.csp`, which already resolved the
 * fallback chain (`ParsedCsp.effective`, `lib/scanner/page-context.ts`), so
 * they only fire when the browser would actually apply the weak policy.
 */

import type { PageCheck } from "../../check-types";
import { excerpt } from "../../check-types";
import { parseCsp } from "../../page-context";

function hasSource(list: string[] | null, needle: string): boolean {
  if (!list) return false;
  const lower = list.map((s) => s.toLowerCase());
  return lower.includes(needle);
}

function hasWildcardHost(list: string[] | null): boolean {
  if (!list) return false;
  return list.some((s) => s === "*" || /^\*\.[a-z0-9.-]+$/i.test(s));
}

/**
 * Hosts that serve caller-controlled JavaScript, so allowlisting one in
 * script-src hands an injected tag a URL the policy already trusts.
 *
 * Two shapes: a JSONP endpoint that reflects a caller-supplied callback name
 * into executable output, and a host that serves arbitrary published packages.
 * Both mean the allowlist is only as strong as the least careful thing anyone
 * has put on that host, which is the reason Google's CSP Evaluator exists.
 */
const CSP_BYPASS_HOSTS = new Set([
  "ajax.googleapis.com",
  "www.google.com",
  "www.googletagmanager.com",
  "storage.googleapis.com",
  "translate.google.com",
  "cdnjs.cloudflare.com",
  "cdn.jsdelivr.net",
  "unpkg.com",
  "esm.sh",
  "s3.amazonaws.com",
  "vercel.live",
]);

/** A nonce that is a word rather than a value. */
const PLACEHOLDER_NONCE =
  /^(?:nonce|random|randomvalue|changeme|change[-_]?me|csp[-_]?nonce|placeholder|example|test|value|xxx+|todo|abc123|123456)$/i;

/** CSP directives the specification drops when the policy arrives in a meta tag. */
const META_IGNORED_DIRECTIVES = [
  "frame-ancestors",
  "report-uri",
  "report-to",
  "sandbox",
];

export const cspChecks: PageCheck[] = [
  {
    id: "page-csp-unsafe-inline-effective",
    title: "CSP allows unsafe-inline for scripts",
    category: "headers",
    severity: "high",
    method: "csp-analysis",
    description:
      "The Content-Security-Policy allows inline scripts to execute, which removes CSP's protection against injected script content.",
    riskImpact:
      "If any part of the page reflects unescaped user input, an attacker can inject a working <script> tag or event handler and it will execute despite the CSP being present.",
    explanation:
      "script-src 'unsafe-inline' permits any inline script or inline event handler on the page to run. It is only mitigated by a nonce, a hash, or 'strict-dynamic' on the same directive.",
    fixSteps: [
      "Move inline scripts to external files served from an allowed origin.",
      "If inline scripts are unavoidable, generate a per-response nonce and add 'nonce-<value>' to script-src.",
      "Remove 'unsafe-inline' once nonces or hashes are in place.",
    ],
    codeExamples: [
      {
        label: "Nonce-based CSP",
        language: "http",
        code: "Content-Security-Policy: script-src 'self' 'nonce-r4nd0m123'",
      },
    ],
    references: ["https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP"],
    needs: ["csp"],
    dedupeGroup: "csp-unsafe-inline",
    run(ctx) {
      const csp = ctx.csp!;
      if (csp.reportOnly) return null;
      const scriptSrc = csp.effective("script-src");
      if (!hasSource(scriptSrc, "'unsafe-inline'")) return null;
      if (
        hasSource(scriptSrc, "'strict-dynamic'") ||
        (scriptSrc ?? []).some((s) => /^'nonce-/i.test(s)) ||
        (scriptSrc ?? []).some((s) => /^'sha(256|384|512)-/i.test(s))
      ) {
        return null;
      }
      if (ctx.isFrameworkPage) return null;
      return {
        evidence: `script-src allows 'unsafe-inline' with no nonce or hash to constrain it (${ctx.framework ? "framework: " + ctx.framework : "resolved from default-src fallback: " + (scriptSrc === csp.directives["script-src"] ? "no" : "yes")}).`,
        excerpts: [excerpt("CSP script-src", (scriptSrc ?? []).join(" "))],
      };
    },
  },

  {
    id: "page-csp-unsafe-eval-effective",
    title: "CSP allows unsafe-eval",
    category: "headers",
    severity: "medium",
    method: "csp-analysis",
    description:
      "The Content-Security-Policy allows eval() and equivalent string-to-code APIs to run.",
    riskImpact:
      "Combined with any sink that passes user input to eval(), Function(), or setTimeout/setInterval with a string, this allows arbitrary code execution.",
    explanation:
      "script-src 'unsafe-eval' permits eval(), new Function(), and string arguments to setTimeout/setInterval. Most modern bundlers do not require it.",
    fixSteps: [
      "Identify which library requires eval (common in older template engines) and update it or replace it.",
      "Remove 'unsafe-eval' from script-src once nothing depends on it.",
    ],
    codeExamples: [],
    needs: ["csp"],
    dedupeGroup: "csp-unsafe-eval",
    run(ctx) {
      const csp = ctx.csp!;
      if (csp.reportOnly) return null;
      const scriptSrc = csp.effective("script-src");
      if (!hasSource(scriptSrc, "'unsafe-eval'")) return null;
      if (ctx.isFrameworkPage) return null;
      return {
        evidence:
          "script-src allows 'unsafe-eval', permitting eval() and Function() to execute.",
        excerpts: [excerpt("CSP script-src", (scriptSrc ?? []).join(" "))],
      };
    },
  },

  {
    id: "page-csp-wildcard-host-source",
    title: "CSP directive allows a wildcard host",
    category: "headers",
    severity: "medium",
    method: "csp-analysis",
    description:
      "A CSP directive that controls script or style loading allows any host, or any subdomain of a host, as a source.",
    riskImpact:
      "A wildcard source defeats the purpose of an allowlist: any origin matching the wildcard, including one an attacker controls or compromises, can serve the resource.",
    explanation:
      "'*' or '*.example.com' in script-src, style-src, or default-src accepts content from any matching origin rather than a specific, trusted set.",
    fixSteps: [
      "Replace wildcard sources with the specific origins the page actually loads from.",
      "Prefer a small, explicit allowlist over a wildcard subdomain match.",
    ],
    codeExamples: [],
    needs: ["csp"],
    dedupeGroup: "csp-wildcard-source",
    run(ctx) {
      const csp = ctx.csp!;
      if (csp.reportOnly) return null;
      const hits: { directive: string; value: string }[] = [];
      for (const directive of ["script-src", "style-src", "default-src"]) {
        const list = csp.directives[directive];
        if (hasWildcardHost(list)) {
          hits.push({ directive, value: list!.join(" ") });
        }
      }
      if (hits.length === 0) return null;
      return {
        evidence: `Wildcard host source in ${hits.map((h) => h.directive).join(", ")}.`,
        excerpts: hits.map((h) => excerpt(`CSP ${h.directive}`, h.value)),
      };
    },
  },

  {
    id: "page-csp-object-src-unrestricted",
    title: "CSP does not restrict object-src or a covering default-src",
    category: "headers",
    severity: "medium",
    method: "csp-analysis",
    description:
      "The Content-Security-Policy does not restrict <object>, <embed>, or <applet> sources, and no default-src 'none' or object-src 'none' covers it.",
    riskImpact:
      "Legacy plugin content (Flash, Java applets, PDF handlers) can be a script execution vector on browsers that still support them, and object-src is one of the few directives CSP does not restrict by default.",
    explanation:
      "Unlike most fetch directives, object-src has no safe default. It must be explicitly set to 'none' or a trusted origin, or covered by default-src 'none'.",
    fixSteps: [
      "Add object-src 'none' unless the page legitimately embeds plugin content.",
      "If default-src 'none' is already set, no additional directive is needed.",
    ],
    codeExamples: [
      {
        label: "Restrict object-src",
        language: "http",
        code: "Content-Security-Policy: object-src 'none'",
      },
    ],
    needs: ["csp"],
    dedupeGroup: "csp-object-src-unrestricted",
    run(ctx) {
      const csp = ctx.csp!;
      if (csp.reportOnly) return null;
      // ParsedCsp.effective("object-src") returns null when NEITHER
      // object-src NOR default-src constrains it, which is the unrestricted
      // (worst) case for this directive, not a covered one: object-src is
      // the one fetch directive with no restrictive default.
      const effective = csp.effective("object-src");
      if (
        effective &&
        effective.length === 1 &&
        effective[0].toLowerCase() === "'none'"
      )
        return null;
      return {
        evidence: `object-src resolves to '${(effective ?? []).join(" ") || "(unrestricted: neither object-src nor default-src is set)"}' rather than 'none'.`,
        excerpts: [
          excerpt(
            "CSP object-src",
            csp.directives["object-src"]?.join(" ") ?? "(not set)",
          ),
        ],
      };
    },
  },

  {
    id: "page-csp-http-source-on-https-page",
    title: "CSP allows plaintext HTTP sources on an HTTPS page",
    category: "headers",
    severity: "high",
    method: "csp-analysis",
    description:
      "The page is served over HTTPS but its CSP script-src or default-src permits loading resources over plain HTTP.",
    riskImpact:
      "A network attacker who can intercept HTTP traffic (a hostile Wi-Fi network, a compromised router) can inject or replace any script the CSP permits over http://, defeating the confidentiality and integrity HTTPS is meant to provide.",
    explanation:
      "CSP source lists that include an explicit http:// scheme, or a bare host with no scheme (which permits both http and https), allow the browser to fetch that resource insecurely even though the page itself loaded over TLS.",
    fixSteps: [
      "Change http:// sources to https://.",
      "Add 'upgrade-insecure-requests' as a defense in depth measure.",
    ],
    codeExamples: [],
    needs: ["csp", "https"],
    dedupeGroup: "csp-http-sources",
    run(ctx) {
      const csp = ctx.csp!;
      if (csp.reportOnly) return null;
      const scriptSrc =
        csp.directives["script-src"] ?? csp.directives["default-src"];
      if (!scriptSrc) return null;
      const httpSources = scriptSrc.filter((s) => /^http:\/\//i.test(s));
      if (httpSources.length === 0) return null;
      const directive = csp.directives["script-src"]
        ? "script-src"
        : "default-src";
      return {
        evidence: `${directive} permits ${httpSources.join(", ")} over plain HTTP on an HTTPS page.`,
        excerpts: [excerpt(`CSP ${directive}`, scriptSrc.join(" "))],
      };
    },
  },

  {
    id: "page-clickjacking-xfo-csp-contradiction",
    title:
      "X-Frame-Options and CSP frame-ancestors give contradictory framing rules",
    category: "headers",
    severity: "high",
    method: "header-value",
    confidence: 90,
    description:
      "The X-Frame-Options header and the CSP frame-ancestors directive disagree about whether this page may be framed.",
    riskImpact:
      "Every browser that supports CSP frame-ancestors (all current major browsers) ignores X-Frame-Options entirely once frame-ancestors is present, per the Content Security Policy specification. A restrictive X-Frame-Options paired with a permissive frame-ancestors looks protected to a header-only scanner but is actually framable in every modern browser.",
    explanation:
      "Detected by comparing the two values directly: X-Frame-Options is read as restrictive when it is DENY or SAMEORIGIN, and frame-ancestors is read as permissive when it names an origin other than the page's own (a wildcard, or a specific third-party origin either one contradicts a DENY/SAMEORIGIN promise). 'self' and the page's own origin written out in full are the same policy, so neither counts as a contradiction.",
    fixSteps: [
      "Make frame-ancestors the source of truth and set it to the intended policy ('none' or 'self').",
      "Keep X-Frame-Options as a fallback for the small number of legacy browsers without frame-ancestors support, but state the same policy there, not a stricter one that CSP silently overrides.",
    ],
    codeExamples: [
      {
        label: "Consistent policy",
        language: "http",
        code: "X-Frame-Options: SAMEORIGIN\nContent-Security-Policy: frame-ancestors 'self'",
      },
    ],
    references: [
      "https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Security-Policy/frame-ancestors",
    ],
    needs: ["csp"],
    run(ctx) {
      const csp = ctx.csp!;
      if (csp.reportOnly) return null;
      const frameAncestors = csp.directives["frame-ancestors"];
      if (!frameAncestors || frameAncestors.length === 0) return null;
      let xfo: string | null;
      try {
        xfo = ctx.headers.get("x-frame-options");
      } catch {
        xfo = null;
      }
      if (!xfo) return null;
      const xfoRestrictive = /^\s*(deny|sameorigin)\s*$/i.test(xfo);
      if (!xfoRestrictive) return null;
      const faValues = frameAncestors.map((s) => s.toLowerCase());
      if (faValues.length === 1 && faValues[0] === "'none'") return null;
      // Writing the page's own origin out in full is the same policy as
      // 'self', not a contradiction of SAMEORIGIN. Plenty of policies say
      // `frame-ancestors 'self' https://www.example.com` (or name the
      // origin instead of using 'self' at all) on https://www.example.com,
      // and this check used to call every one of them a high-severity
      // contradiction because it only recognised the literal token 'self'.
      const ownHost = ctx.hostname.toLowerCase();
      const foreign = faValues.filter((s) => {
        if (s === "'self'") return false;
        const host = s
          .replace(/^'|'$/g, "")
          .replace(/^[a-z][a-z0-9+.-]*:\/\//, "")
          .replace(/:\d+$/, "")
          .replace(/\/.*$/, "");
        return host !== ownHost;
      });
      if (foreign.length === 0) return null;
      return {
        evidence: `X-Frame-Options: ${xfo} looks restrictive, but CSP frame-ancestors permits ${frameAncestors.join(" ")}, and frame-ancestors is what browsers actually enforce.`,
        excerpts: [
          excerpt("X-Frame-Options", xfo),
          excerpt("CSP frame-ancestors", frameAncestors.join(" ")),
        ],
      };
    },
  },

  {
    id: "page-csp-frame-ancestors-wildcard",
    title: "CSP frame-ancestors allows a wildcard set of origins",
    category: "headers",
    severity: "medium",
    method: "csp-analysis",
    confidence: 90,
    description:
      "The frame-ancestors directive permits any origin, or any subdomain of a host, to embed this page in a frame.",
    riskImpact:
      "frame-ancestors is the modern replacement for X-Frame-Options and is what current browsers actually enforce. A wildcard here means the clickjacking protection the directive is meant to provide does not apply to anyone.",
    explanation:
      "frame-ancestors is checked directly here, separate from the general wildcard-host-source check in this scanner (which covers script-src, style-src, and default-src), because frame-ancestors controls who may embed the page: a distinct security property from where the page loads its own resources.",
    fixSteps: [
      "Replace the wildcard with the specific origin(s) meant to embed this page, 'self' if none should, or 'none' if the page should never be framed.",
    ],
    codeExamples: [
      {
        label: "Restricted frame-ancestors",
        language: "http",
        code: "Content-Security-Policy: frame-ancestors 'self'",
      },
    ],
    needs: ["csp"],
    run(ctx) {
      const csp = ctx.csp!;
      if (csp.reportOnly) return null;
      const frameAncestors = csp.directives["frame-ancestors"];
      if (!frameAncestors) return null;
      const hasWildcard = frameAncestors.some(
        (s) => s === "*" || /^\*\.[a-z0-9.-]+$/i.test(s),
      );
      if (!hasWildcard) return null;
      return {
        evidence: `frame-ancestors permits a wildcard: ${frameAncestors.join(" ")}.`,
        excerpts: [excerpt("CSP frame-ancestors", frameAncestors.join(" "))],
      };
    },
  },
  {
    id: "page-csp-script-src-bypass-host",
    title: "CSP script-src allows a known bypass host",
    category: "headers",
    severity: "medium",
    method: "csp-analysis",
    description:
      "The policy allowlists a host that serves attacker-controllable JavaScript, so an injected script can load from an origin the policy already trusts.",
    riskImpact:
      "Several of the largest CDNs host either a JSONP endpoint that echoes a caller-supplied callback name, or arbitrary published packages. Allowlisting one of them in script-src means an attacker who can inject a <script src> tag picks a URL on that trusted host and the policy permits it. The site has a Content-Security-Policy and no protection against script injection, which is the case the policy was added to prevent.",
    explanation:
      "This is the finding Google's own CSP Evaluator exists for. A host allowlist is only as strong as the least careful thing on the allowlisted host, and on a general-purpose CDN that is whatever anyone has published. 'strict-dynamic' removes the problem entirely: it makes the host list inert and grants trust through the nonce instead, which is why a policy that carries it is not reported here.",
    fixSteps: [
      "Add 'strict-dynamic' with a per-response nonce, which makes the host allowlist irrelevant and is the recommended modern shape.",
      "If the allowlist has to stay, narrow each entry to a path rather than a bare host: https://cdn.example.com/lib/v1.2.3/ rather than cdn.example.com.",
      "Self-host the handful of scripts that actually need to be there.",
    ],
    codeExamples: [
      {
        label: "A policy the host list cannot weaken",
        language: "http",
        code: "Content-Security-Policy: script-src 'nonce-r4nd0m123' 'strict-dynamic' https: 'unsafe-inline'",
      },
    ],
    references: [
      "https://csp-evaluator.withgoogle.com/",
      "https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP",
    ],
    needs: ["csp"],
    run(ctx) {
      const csp = ctx.csp!;
      if (csp.reportOnly) return null;
      const sources = csp.effective("script-src");
      if (!sources) return null;
      // 'strict-dynamic' makes every host in the list inert: trust flows from
      // the nonce to whatever that script loads, and a bare host expression is
      // ignored outright. Reporting one then would be reporting a string.
      if (sources.some((s) => s.toLowerCase() === "'strict-dynamic'")) {
        return null;
      }
      const hits = sources.filter((source) => {
        const stripped = source.replace(/^https?:\/\//i, "");
        const slash = stripped.indexOf("/");
        // A path-scoped source is materially safer: it pins the allowlist to
        // one directory rather than to everything the host will ever serve.
        if (slash !== -1 && stripped.slice(slash + 1).length > 0) return false;
        const host = (slash === -1 ? stripped : stripped.slice(0, slash))
          .replace(/:\d+$/, "")
          .toLowerCase();
        return CSP_BYPASS_HOSTS.has(host);
      });
      if (hits.length === 0) return null;
      return {
        evidence: `script-src allowlists ${hits.join(", ")}, ${hits.length === 1 ? "a host" : "hosts"} known to serve caller-controlled JavaScript.`,
        excerpts: [excerpt("CSP script-src", sources.join(" "))],
      };
    },
  },

  {
    id: "page-csp-nonce-low-entropy",
    title: "CSP nonce is a placeholder, static, or too short",
    category: "headers",
    severity: "high",
    method: "csp-analysis",
    description:
      "The policy's nonce is not a fresh unguessable value: it is an unrendered template placeholder, a fixed string, or too short to resist guessing.",
    riskImpact:
      "A nonce is the whole of a nonce-based policy. If the same value is served to every visitor, or if the templating never ran and every response literally carries {{cspNonce}}, an attacker reads it from their own copy of the page and puts it on the script they inject. The policy then permits the injection it was written to block, while every other check on the page reports that a nonce-based CSP is present.",
    explanation:
      "CSP requires a nonce to be unpredictable and regenerated per response. The two failure modes visible in a single response are a placeholder the template engine never substituted, and a value short enough to brute force. Both look correct to anything that only asks whether a nonce exists.",
    fixSteps: [
      "Generate the nonce per response from a CSPRNG: at least 16 bytes, base64 encoded.",
      "Check that the templating actually substitutes it: fetch the page twice and confirm the value differs.",
      "Never reuse a nonce across responses or cache a response that contains one.",
    ],
    codeExamples: [
      {
        label: "A nonce per response",
        language: "javascript",
        code: "const nonce = crypto.randomBytes(16).toString('base64');\nres.setHeader('Content-Security-Policy', `script-src 'nonce-${nonce}' 'strict-dynamic'`);",
      },
    ],
    references: [
      "https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Security-Policy/script-src",
    ],
    needs: ["csp"],
    run(ctx) {
      const csp = ctx.csp!;
      const nonces = Object.values(csp.directives)
        .flat()
        .filter((s) => /^'nonce-/i.test(s))
        .map((s) => s.slice("'nonce-".length).replace(/'$/, ""));
      if (nonces.length === 0) return null;
      const bad = nonces.filter(
        (n) =>
          // A template expression that reached the browser: the substitution
          // never ran, so every visitor gets the same literal.
          /^(?:\{\{|\{%|\$\{|<%|\[\[|%\(|#\{)/.test(n) ||
          PLACEHOLDER_NONCE.test(n) ||
          n.length < 16 ||
          /^(.)\1*$/.test(n),
      );
      if (bad.length === 0) return null;
      return {
        evidence: `CSP nonce ${bad.map((n) => `'${n}'`).join(", ")} is not a per-response random value.`,
        excerpts: [excerpt("CSP", csp.raw)],
      };
    },
  },

  {
    id: "page-meta-csp-directive-ignored",
    title: "Meta-tag CSP declares a directive browsers ignore there",
    category: "headers",
    severity: "medium",
    method: "dom-structure",
    description:
      'A <meta http-equiv="Content-Security-Policy"> declares frame-ancestors, report-uri, report-to or sandbox, which the specification makes header-only and browsers drop from a meta tag.',
    riskImpact:
      "The team believes the page is protected and it is not. frame-ancestors in a meta tag is the common case: the site reads as clickjacking-protected in its own source, no browser enforces it, and the page frames anywhere. Reporting violations is the other half, and a report-uri that is silently ignored means nothing is being collected while a dashboard says otherwise.",
    explanation:
      "The CSP specification lists frame-ancestors, report-uri, report-to and sandbox as directives that are ignored when the policy arrives in a meta element. They have to be delivered as a response header. The rest of the policy in the same meta tag is still applied, which is what makes this hard to notice.",
    fixSteps: [
      "Move the policy, or at least these directives, into a Content-Security-Policy response header.",
      "Keep X-Frame-Options as a header too, for anything that predates frame-ancestors.",
      "Verify with the browser console: an ignored directive is reported there on load.",
    ],
    codeExamples: [
      {
        label: "nginx",
        language: "nginx",
        code: "add_header Content-Security-Policy \"default-src 'self'; frame-ancestors 'none'\" always;",
      },
    ],
    references: [
      "https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Security-Policy#directives",
    ],
    run(ctx) {
      const meta = ctx.metas.find(
        (m) => m.httpEquiv?.toLowerCase() === "content-security-policy",
      );
      if (!meta?.content) return null;
      const header = ctx.headers.get("content-security-policy") ?? "";
      const inMeta = parseCsp(meta.content).directives;
      const ignored = META_IGNORED_DIRECTIVES.filter(
        (d) =>
          d in inMeta &&
          // Declared in the header too, so it is enforced and the meta copy is
          // redundant rather than broken.
          !new RegExp(`(?:^|;)\\s*${d}\\b`, "i").test(header),
      );
      if (ignored.length === 0) return null;
      return {
        evidence: `The meta CSP declares ${ignored.join(", ")}, which ${ignored.length === 1 ? "is" : "are"} ignored in a meta tag and absent from the response header.`,
        excerpts: [excerpt("meta CSP", meta.content)],
      };
    },
  },

  {
    id: "page-meta-x-frame-options-ignored",
    title: "X-Frame-Options declared in a meta tag, which no browser honours",
    category: "headers",
    severity: "medium",
    method: "dom-structure",
    description:
      'The page carries <meta http-equiv="X-Frame-Options">, which has never been honoured by any browser, and no equivalent protection arrives as a response header.',
    riskImpact:
      "The page can be framed by any site. That is the ordinary clickjacking exposure, with the extra problem that the source says otherwise: somebody added this tag believing it did something, so the gap will not be found by reading the code.",
    explanation:
      "X-Frame-Options is defined as a response header and browsers deliberately ignore the meta form, which is why this tag is so widely copy-pasted and so rarely questioned. The modern replacement is the CSP frame-ancestors directive, which must also arrive as a header.",
    fixSteps: [
      "Send Content-Security-Policy: frame-ancestors 'none' as a response header, or 'self' if the site frames its own pages.",
      "Send X-Frame-Options: DENY alongside it for older clients.",
      "Delete the meta tag, so nothing suggests the protection is in place twice.",
    ],
    codeExamples: [
      {
        label: "The header form, which works",
        language: "nginx",
        code: 'add_header X-Frame-Options "DENY" always;\nadd_header Content-Security-Policy "frame-ancestors \'none\'" always;',
      },
    ],
    references: [
      "https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/X-Frame-Options",
    ],
    dedupeGroup: "clickjacking",
    run(ctx) {
      const meta = ctx.metas.find(
        (m) => m.httpEquiv?.toLowerCase() === "x-frame-options",
      );
      if (!meta) return null;
      // The header does the work, so the tag is redundant rather than a gap.
      if (ctx.headers.get("x-frame-options")) return null;
      if (
        ctx.csp &&
        !ctx.csp.reportOnly &&
        "frame-ancestors" in ctx.csp.directives
      ) {
        return null;
      }
      return {
        evidence: `<meta http-equiv="X-Frame-Options" content="${meta.content ?? ""}"> is present, and no X-Frame-Options header or CSP frame-ancestors directive is.`,
        excerpts: [excerpt("meta tag", meta.raw)],
      };
    },
  },
];
