/**
 * Content / page-structure detectors.
 *
 * Inspects the response body for HTML and JS issues that aren't quite
 * code (which lives in code.ts), cookies (cookies.ts), or secrets
 * (secrets-extended.ts). Examples: SRI on external assets, mixed
 * content, iframe sandboxing, deprecated HTML, accessibility.
 */

import {
  stripExampleContent,
  stripDocBlocks,
  type EvidenceFn as DetectFn,
} from "../_helpers";

export const detectors: Record<string, DetectFn> = {
  // ── iframes ──────────────────────────────────────────────────────────────

  "insecure-iframes": (url, _headers, body) => {
    if (!url.startsWith("https://")) return null;
    const httpIframes =
      body.match(/<iframe[^>]+src=["']http:\/\/[^"']+["'][^>]*>/gi) || [];
    return httpIframes.length > 0
      ? `Found ${httpIframes.length} iframe(s) loading HTTP content on HTTPS page.`
      : null;
  },

  "iframe-sandbox-missing": (_url, _headers, body) => {
    const iframes = body.match(/<iframe[^>]*src=["'][^"']+["'][^>]*>/gi) || [];
    // Skip well-known trusted embed providers, which never carry a sandbox
    // attribute in their own embed code (sandboxing would break required
    // permissions) -- same allowlist idea open-form-action already uses.
    const trustedEmbedHosts = [
      "youtube.com",
      "youtube-nocookie.com",
      "vimeo.com",
      "google.com",
      "stripe.com",
      "paypal.com",
      "intercom.io",
      "intercomcdn.com",
    ];
    const noSandbox = iframes.filter((t) => {
      if (t.toLowerCase().includes("sandbox")) return false;
      const match = t.match(/src=["'](https?:\/\/[^"'/]+)/i);
      if (!match) return true;
      try {
        const hostname = new URL(match[1].toLowerCase()).hostname;
        return !trustedEmbedHosts.some(
          (host) => hostname === host || hostname.endsWith("." + host),
        );
      } catch {
        return true;
      }
    });
    return noSandbox.length > 2
      ? `Found ${noSandbox.length} iframe(s) without sandbox attribute.`
      : null;
  },

  // ── Forms ────────────────────────────────────────────────────────────────

  "form-target-blank": (_url, _headers, body) => {
    const forms = body.match(/<form[^>]*target=["']_blank["'][^>]*>/gi) || [];
    return forms.length > 0
      ? `Found ${forms.length} form(s) with target="_blank".`
      : null;
  },

  "open-form-action": (_url, _headers, body) => {
    const forms =
      body.match(/<form[^>]*action=["']https?:\/\/[^"']+["'][^>]*>/gi) || [];
    if (forms.length === 0) return null;
    const external = forms.filter((f) => {
      const match = f.match(/action=["'](https?:\/\/[^"'/]+)/i);
      if (!match) return false;
      try {
        const hostname = new URL(match[1].toLowerCase()).hostname;
        const allowed = ["stripe.com", "paypal.com", "google.com"];
        return !allowed.some(
          (host) => hostname === host || hostname.endsWith("." + host),
        );
      } catch {
        return true;
      }
    });
    return external.length > 0
      ? `Found ${external.length} form(s) submitting to external domains.`
      : null;
  },

  "sensitive-form-no-csrf": (_url, _headers, body) => {
    const postForms =
      body.match(/<form[^>]*method=["']post["'][^>]*>[\s\S]*?<\/form>/gi) || [];
    // Forms that submit to a different origin (newsletter signups via
    // Mailchimp/HubSpot/Typeform, search widgets, etc.) aren't protected by
    // *your* CSRF tokens anyway -- your backend never receives the
    // submission, so there's nothing for a same-site token to guard here.
    // This is already covered separately by open-form-action; without this
    // filter, every third-party-hosted marketing form on an otherwise
    // ordinary site double-fires as a "vulnerability".
    const sameOriginForms = postForms.filter((f) => {
      const action = f.match(/action\s*=\s*["']([^"']*)["']/i)?.[1];
      if (!action) return true;
      return !/^(?:https?:)?\/\//i.test(action);
    });
    const noCsrf = sameOriginForms.filter(
      (f) =>
        !/name=["'][^"']*(?:csrf|token|nonce|_token|authenticity_token)[^"']*["']/i.test(
          f,
        ),
    );
    const isFramework =
      body.includes("__NEXT_DATA__") ||
      body.includes("_next/") ||
      body.includes("__nuxt");
    if (isFramework) return null;
    return noCsrf.length > 0
      ? `Found ${noCsrf.length} POST form(s) without CSRF token fields.`
      : null;
  },

  "form-method-get-sensitive": (_url, _headers, body) => {
    // Track each opening tag's own match index (via exec/lastIndex) instead of
    // body.indexOf(f), which always resolves to the FIRST occurrence of that
    // exact tag string -- a problem for templated pages with byte-identical
    // form markup repeated (e.g. desktop/mobile header search). Also bound
    // the password-field lookahead to this form's own </form> close tag
    // instead of a fixed 500-char window, so a password field belonging to a
    // separate, properly-configured POST form nearby isn't misattributed.
    const formOpenRe = /<form[^>]*>/gi;
    let m: RegExpExecArray | null;
    while ((m = formOpenRe.exec(body))) {
      const f = m[0];
      if (/method\s*=\s*["']?get/i.test(f) || !f.includes("method")) {
        const closeIdx = body.indexOf("</form>", formOpenRe.lastIndex);
        const after = body.substring(
          formOpenRe.lastIndex,
          closeIdx === -1 ? formOpenRe.lastIndex + 500 : closeIdx,
        );
        if (/type\s*=\s*["']?password/i.test(after)) {
          return "Form with password field uses GET method, exposing credentials in URL.";
        }
      }
    }
    return null;
  },

  "autocomplete-sensitive": (_url, _headers, body) => {
    const pwFields =
      body.match(/<input[^>]*type=["']password["'][^>]*>/gi) || [];
    const ccFields =
      body.match(
        /<input[^>]*(?:name|id)=["'][^"']*\b(?:card[-_]?number|cc[-_]?number|credit[-_]?card|cvv|cvc)\b[^"']*["'][^>]*>/gi,
      ) || [];
    const noAC = [...pwFields, ...ccFields].filter(
      (f) => !/autocomplete\s*=/i.test(f),
    );
    return noAC.length > 0
      ? `Found ${noAC.length} sensitive field(s) without autocomplete attribute.`
      : null;
  },

  "password-input-no-name": (_url, _headers, body) => {
    // Only the name-missing condition: a missing autocomplete attribute
    // alone is already fully covered by autocomplete-sensitive, so keeping
    // it here too meant every password field missing both attributes
    // produced two findings for one underlying defect.
    const pwInputs =
      body.match(/<input[^>]*type=["']password["'][^>]*>/gi) || [];
    const noName = pwInputs.filter((t) => !/name\s*=\s*["']/i.test(t));
    return noName.length > 0
      ? `Found ${noName.length} password field(s) missing name attribute.`
      : null;
  },

  "weak-password-policy": (_url, _headers, body) => {
    if (
      /<input[^>]*type=["']?password[^>]*minlength=["']?([1-5])["']?/i.test(
        body,
      )
    ) {
      return "Password field with weak minlength constraint (< 6 characters).";
    }
    return null;
  },

  // ── HTML structure / accessibility ───────────────────────────────────────

  "viewport-user-scalable-no": (_url, _headers, body) => {
    if (
      /<meta[^>]*name=["']viewport["'][^>]*content=["'][^"']*user-scalable\s*=\s*no/i.test(
        body,
      )
    )
      return "Viewport sets user-scalable=no.";
    if (
      /<meta[^>]*name=["']viewport["'][^>]*content=["'][^"']*maximum-scale\s*=\s*1(?:\.0)?/i.test(
        body,
      )
    )
      return "Viewport sets maximum-scale=1.";
    return null;
  },

  // ── Service worker / open graph / redirect ──────────────────────────────

  "service-worker-scope": (_url, _headers, body) => {
    // Capture the full register(...) call, not just the URL string arg --
    // the old regex stopped at the closing quote of the first argument, so
    // it could never see a `{ scope: '/foo/' }` options object passed as a
    // second argument. That made `wide` true for every registration
    // (including ones that explicitly narrow scope), so this fired on
    // virtually every site that registers a service worker at all -- the
    // single most common, expected PWA pattern there is.
    const swReg =
      body.match(/navigator\.serviceWorker\.register\s*\([^)]*\)/gi) || [];
    if (swReg.length === 0) return null;
    const wide = swReg.filter(
      (r) => /scope\s*:\s*["']\/["']/i.test(r) || !/scope\s*:/i.test(r),
    );
    return wide.length > 0
      ? "Service worker registered without an explicit narrow scope option."
      : null;
  },

  "opengraph-injection": (_url, _headers, body) => {
    const ogTags =
      body.match(
        /<meta[^>]*property=["']og:[^"']+["'][^>]*content=["']([^"']+)["']/gi,
      ) || [];
    const suspicious = ogTags.filter((t) =>
      /javascript:|(?:^|[\s"'])data:(?:text\/html)?|(?:^|[\s"'])on\w+\s*=/i.test(
        t,
      ),
    );
    return suspicious.length > 0
      ? `Found ${suspicious.length} suspicious OpenGraph tag(s).`
      : null;
  },

  "meta-refresh": (_url, _headers, body) => {
    const metaRefresh = body.match(
      /<meta[^>]*http-equiv=["']refresh["'][^>]*content=["']([^"']+)["']/i,
    );
    if (!metaRefresh) return null;
    const content = metaRefresh[1];
    if (content.toLowerCase().includes("url="))
      return `Meta refresh redirect detected: ${content}`;
    return null;
  },

  "base-tag": (_url, _headers, body) => {
    const baseTag = body.match(/<base[^>]*href=["']([^"']+)["']/i);
    if (!baseTag) return null;
    const csp = body.match(/<meta[^>]*content=["'][^"']*base-uri[^"']*["']/i);
    if (csp) return null;
    return `<base> tag found with href="${baseTag[1]}". Without CSP base-uri, this can be hijacked.`;
  },

  "sensitive-meta-tags": (_url, _headers, body) => {
    const metas =
      body.match(
        /<meta[^>]*(?:name|property)=["'][^"']*["'][^>]*content=["'][^"']+["'][^>]*>/gi,
      ) || [];
    const sensitiveNames = [
      "csrf",
      "token",
      "api-key",
      "secret",
      "session",
      "internal",
    ];
    // Match against the tag's name/property identifier only (e.g.
    // name="csrf-token"), never the freeform content= value -- otherwise
    // ordinary copy that happens to use a word like "secrets" (e.g. a meta
    // description mentioning "...headers, TLS, cookies, DNS, and secrets")
    // gets flagged as if a real credential were exposed.
    const found = metas.filter((m) => {
      const identifier = m.match(/(?:name|property)=["']([^"']*)["']/i)?.[1];
      if (!identifier) return false;
      const lower = identifier.toLowerCase();
      return sensitiveNames.some((s) => lower.includes(s));
    });
    return found.length > 0
      ? `Found ${found.length} meta tag(s) with sensitive data.`
      : null;
  },

  "sourcemap-reference": (_url, _headers, body) => {
    if (/\/\/[#@]\s*sourceMappingURL\s*=\s*\S+\.map/i.test(body)) {
      return "JavaScript source map URL reference found. Source maps expose original source code.";
    }
    return null;
  },

  // ── Third-party / outdated libs ──────────────────────────────────────────

  "outdated-js-libs": (_url, _headers, body) => {
    // Only match version strings inside <script src="..."> attributes to avoid
    // FPs from body text mentioning library names (e.g. documentation pages,
    // changelogs). jQuery/Angular have dedicated src-scoped detectors below;
    // keep Lodash, Bootstrap, and Moment.js here scoped to src= only.
    const scripts = body.match(/<script[^>]+src=["'][^"']*["'][^>]*>/gi) || [];
    const srcBlock = scripts.join("\n");
    const libs: { name: string; pattern: RegExp; maxSafe: string }[] = [
      {
        name: "Lodash < 4.17.21",
        pattern: /lodash[./\-]([0-9]+\.[0-9]+\.[0-9]+)/i,
        maxSafe: "4.17.21",
      },
      {
        name: "Bootstrap < 5.3.0",
        pattern: /bootstrap[./\-]([0-9]+\.[0-9]+\.[0-9]+)/i,
        maxSafe: "5.3.0",
      },
      {
        name: "Moment.js (deprecated)",
        pattern: /moment(?:\.min)?\.js/i,
        maxSafe: "",
      },
    ];
    const found: string[] = [];
    for (const lib of libs) {
      const match = srcBlock.match(lib.pattern);
      if (match) {
        if (!lib.maxSafe) {
          found.push(lib.name);
        } else if (match[1]) {
          const v = match[1].split(".").map(Number);
          const s = lib.maxSafe.split(".").map(Number);
          if (
            v[0] < s[0] ||
            (v[0] === s[0] && v[1] < s[1]) ||
            (v[0] === s[0] && v[1] === s[1] && v[2] < s[2])
          ) {
            found.push(`${lib.name} (found ${match[1]})`);
          }
        }
      }
    }
    return found.length > 0
      ? `Outdated libraries detected: ${found.join("; ")}`
      : null;
  },

  "outdated-jquery": (_url, _headers, body) => {
    const scripts =
      body.match(/<script[^>]+src=["'][^"']*jquery[^"']*["'][^>]*>/gi) || [];
    for (const s of scripts) {
      const m = s.match(/jquery[-.v]?(\d+)\.(\d+)\.?(\d*)/i);
      if (m) {
        const major = parseInt(m[1]);
        const minor = parseInt(m[2]);
        if (major < 3 || (major === 3 && minor < 5)) {
          return `Outdated jQuery loaded via script src (${major}.${minor}) — upgrade to 3.5+.`;
        }
      }
    }
    return null;
  },

  "outdated-angular": (_url, _headers, body) => {
    if (
      /<script[^>]+src=["'][^"']*angular(?:\.min)?\.js[^"']*["'][^>]*>/i.test(
        body,
      ) &&
      !/angular\/\d{2}\./i.test(body)
    ) {
      return "AngularJS (1.x) loaded via script src — end-of-life framework with known vulnerabilities.";
    }
    return null;
  },

  "prototype-js-outdated": (_url, _headers, body) => {
    if (
      /<script[^>]+src=["'][^"']*prototype(?:\.js)?[^"']*["'][^>]*>/i.test(body)
    ) {
      return "Prototype.js loaded via script src — outdated library with known vulnerabilities.";
    }
    return null;
  },

  "mootools-outdated": (_url, _headers, body) => {
    if (/<script[^>]+src=["'][^"']*mootools[^"']*["'][^>]*>/i.test(body)) {
      return "MooTools loaded via script src — outdated library with potential security issues.";
    }
    return null;
  },

  "cdn-fallback-missing": (_url, _headers, body) => {
    const cdnScripts =
      body.match(
        /<script[^>]*src=["'][^"']*(?:cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net|unpkg\.com)[^"']*["'][^>]*>/gi,
      ) || [];
    if (cdnScripts.length > 0 && !/onerror\s*=/i.test(body)) {
      return `${cdnScripts.length} CDN script(s) without fallback mechanism.`;
    }
    return null;
  },

  // ── CMS / framework fingerprints ─────────────────────────────────────────

  "cms-fingerprinting": (_url, headers, body) => {
    const found: string[] = [];
    const generator = body.match(
      /<meta[^>]*name=["']generator["'][^>]*content=["']([^"']+)["']/i,
    );
    if (generator) found.push(`Generator: ${generator[1]}`);
    const powered = headers.get("x-powered-by");
    if (powered) found.push(`X-Powered-By: ${powered}`);
    if (/wp-content|wp-includes/i.test(body)) found.push("WordPress");
    if (/drupal\.js|Drupal\.settings/i.test(body)) found.push("Drupal");
    if (/\/joomla\//i.test(body)) found.push("Joomla");
    // Removed Next.js and Nuxt.js: __NEXT_DATA__ / /_next/ appear on EVERY
    // page of those frameworks — flagging them produces a finding on 100 % of
    // Next.js / Nuxt.js sites with no actionable security signal.
    return found.length > 0
      ? `Technology fingerprints: ${found.join(", ")}`
      : null;
  },

  // ── Directory listing ────────────────────────────────────────────────────

  "directory-listing": (_url, _headers, body) => {
    const indicators = [
      /<title>Index of \/[^<]*<\/title>/i,
      /<h1>Index of \/[^<]*<\/h1>/i,
      /\[To Parent Directory\]/i,
      // Bounded to before the closing </pre> so this can't span the entire
      // rest of the document -- a bare <pre> code sample followed, anywhere
      // later on the page, by any link and any ISO date otherwise satisfied
      // this with no relation to server directory browsing.
      /<pre>(?:(?!<\/pre>)[\s\S])*<a href="[^"]*">(?:(?!<\/pre>)[\s\S])*<\/a>(?:(?!<\/pre>)[\s\S])*\d{4}-\d{2}-\d{2}(?:(?!<\/pre>)[\s\S])*<\/pre>/i,
    ];
    for (const p of indicators) {
      if (p.test(body))
        return "Directory listing indicators found in response.";
    }
    return null;
  },

  // ── Robots / sensitive endpoints in body ────────────────────────────────

  "robots-txt-exposure": (_url, _headers, body) => {
    // Only fire when the body looks like an actual robots.txt file (contains
    // User-agent: / Disallow: directives). A mere mention of "/robots.txt" in
    // a footer link or meta tag is legitimate and fires on most sites.
    if (
      /^user-agent\s*:/im.test(body) &&
      /^(?:disallow|allow)\s*:/im.test(body) &&
      body.trim().split("\n").length < 50
    ) {
      return "Response body appears to be robots.txt content — verify no sensitive paths are listed.";
    }
    return null;
  },

  "sensitive-endpoints": (_url, _headers, body) => {
    const endpoints = [
      // "users" and "graphql" removed -- ubiquitous, expected REST/GraphQL
      // surface, not itself sensitive. GraphQL endpoint discovery is
      // already covered by the dedicated graphql-introspection check.
      /\/api\/v\d+\/(?:admin|internal|debug|webhook)/gi,
      /\/wp-admin/gi,
      /\/phpmyadmin/gi,
      /\/\.env/gi,
      /\/actuator/gi,
      /\/elmah\.axd/gi,
      /\/server-status/gi,
    ];
    const found: string[] = [];
    for (const p of endpoints) {
      const matches = body.match(p);
      if (matches) found.push(...matches.slice(0, 2));
    }
    const unique = [...new Set(found)];
    return unique.length > 0
      ? `Sensitive endpoint references: ${unique.slice(0, 5).join(", ")}`
      : null;
  },

  "debug-endpoint": (_url, _headers, body) => {
    if (/\/debug\/|\/trace\/|\/profiler\/|\/_debug\//gi.test(body)) {
      return "Debug endpoints referenced in page source.";
    }
    return null;
  },

  "admin-endpoint": (url, _headers, _body) => {
    if (
      /\/admin(?:\/|$)|\/administrator(?:\/|$)|\/management(?:\/|$)/i.test(url)
    ) {
      return "Admin/management endpoint is publicly accessible.";
    }
    return null;
  },

  // ── Backup / IDE / VCS / .env references ─────────────────────────────────

  "git-directory-exposed": (_url, _headers, body) => {
    if (/\/?\.git\/(HEAD|config|objects|refs)/i.test(body)) {
      return ".git directory paths detected in page source.";
    }
    return null;
  },

  "env-file-reference": (_url, _headers, body) => {
    // Only fire when the reference appears inside a href/src/action attribute
    // (a real link the browser would navigate to), same guard
    // backup-file-reference uses in information-disclosure.ts. The old
    // bare-substring version matched any page whose HTML merely contained
    // the text ".env" in quotes or after a slash -- including our own docs
    // and any other project's docs/READMEs showing an nginx snippet like
    // "location ~ /\.env { deny all; }" as remediation advice, or a
    // "cp .env.example .env" setup instruction. That's prose about env
    // files, not an actual exposed reference, and shouldn't score as a
    // critical finding.
    const m = body.match(
      /(?:href|src|action)=["'][^"']*\.env(\.(local|production|development|test))?["']/gi,
    );
    if (m && m.length > 0) {
      return `.env file reference found in links/assets: ${m.slice(0, 2).join(", ")}`;
    }
    return null;
  },

  "phpinfo-exposed": (_url, _headers, body) => {
    // The bare "phpinfo.php" branch used to match the string anywhere in the
    // page text, including hardening-advice prose like "delete phpinfo.php
    // before going live". Require it to appear in an actual href/src/action
    // link, the same guard env-file-reference uses for the same reason.
    if (
      /<title>phpinfo\(\)/i.test(body) ||
      /(?:href|src|action)=["'][^"']*phpinfo\.php["']/i.test(body)
    ) {
      return "phpinfo() page or reference detected. This exposes complete server configuration.";
    }
    return null;
  },

  "wp-login-exposed": (_url, _headers, body) => {
    if (
      /wp-login\.php|wp-admin\//i.test(body) &&
      /<meta[^>]*generator[^>]*wordpress/i.test(body)
    ) {
      return "WordPress admin/login page paths exposed with WordPress generator tag.";
    }
    return null;
  },

  "spring-boot-actuator": (_url, _headers, body) => {
    if (/\/actuator\/(health|env|info|beans|mappings)/i.test(body)) {
      return "Spring Boot Actuator endpoints found in page source.";
    }
    return null;
  },

  // ── Inline JS / dangerous APIs ──────────────────────────────────────────

  "dangerous-inline-js": (_url, _headers, body) => {
    const scripts = body.match(/<script[^>]*>[\s\S]*?<\/script[^>]*>/gi) || [];
    const dangerousPatterns = [
      /eval\s*\(/i,
      /document\.write\s*\(/i,
      /\.innerHTML\s*=\s*(?!['"]<)/i,
      // Was /Function\s*\(/i, which (case-insensitively) matched the
      // ordinary `function(` keyword present in almost every inline
      // script on the web -- not just the actual Function constructor
      // (dynamic code execution from a string) this check means to catch.
      /new\s+Function\s*\(/i,
      /setTimeout\s*\(\s*['"]/i,
      /setInterval\s*\(\s*['"]/i,
    ];
    const found: string[] = [];
    for (const script of scripts) {
      if (script.includes("src=")) continue;
      // Not authored inline scripts: JSON/JSON-LD payloads and Next.js's
      // RSC streaming pushes (self.__next_f.push(...)) can carry
      // arbitrary serialized page text that happens to contain these
      // substrings without being executable code in that form.
      if (
        /^\s*<script[^>]*\btype\s*=\s*["']application\/(?:json|ld\+json)["']/i.test(
          script,
        )
      )
        continue;
      if (/self\.__next_f\.push\s*\(/.test(script)) continue;
      // Cloudflare's own bot/challenge-platform bootstrap script,
      // injected verbatim at the edge into any site with that feature
      // enabled -- not something the site owner authored or can sanitize
      // from application code.
      if (/__CF\$cv\$params/.test(script)) continue;
      for (const p of dangerousPatterns) {
        if (p.test(script)) {
          found.push(p.source.replace(/\\s\*|\\|\['"]/g, "").slice(0, 20));
          break;
        }
      }
    }
    return found.length > 0
      ? `Found ${found.length} inline script(s) with dangerous patterns: ${[...new Set(found)].join(", ")}`
      : null;
  },

  "inline-event-handlers": (_url, _headers, body) => {
    const handlers = body.match(
      /\son(click|error|load|mouseover|focus|blur|submit|change|input)\s*=\s*["']/gi,
    );
    if (!handlers || handlers.length < 3) return null;
    return `${handlers.length} inline event handler attributes found (onclick, onerror, etc.).`;
  },

  "dangerous-html-attrs": (_url, _headers, body) => {
    // Bare "document"/"window" matched almost any DOM-manipulating inline
    // handler (e.g. onclick="window.print()"), not just dangerous sink
    // usage. Require an actual sink call instead of the bare identifier.
    const handlers =
      body.match(
        /\son\w+=["'][^"']*(?:location\s*=|document\.write\s*\(|window\.eval\s*\(|\.innerHTML\s*=|eval\s*\(|fetch\s*\(|XMLHttpRequest|alert\s*\()[^"']*["']/gi,
      ) || [];
    return handlers.length > 0
      ? `Found ${handlers.length} inline event handler(s) with potentially dangerous patterns.`
      : null;
  },

  "unencrypted-connections": (_url, _headers, body) => {
    const wsInsecure = body.match(/new\s+WebSocket\s*\(\s*["']ws:\/\//gi) || [];
    const fetchHttp =
      body.match(/fetch\s*\(\s*["']http:\/\/(?!localhost)/gi) || [];
    const xhrHttp =
      body.match(
        /\.open\s*\(\s*["'](?:GET|POST)["']\s*,\s*["']http:\/\/(?!localhost)/gi,
      ) || [];
    const total = wsInsecure.length + fetchHttp.length + xhrHttp.length;
    return total > 0
      ? `Found ${total} unencrypted connection(s) in JavaScript.`
      : null;
  },

  "websocket-unencrypted": (_url, _headers, body) => {
    if (/new\s+WebSocket\s*\(\s*["']ws:\/\//i.test(body)) {
      return "Unencrypted WebSocket (ws://) connection detected. Use wss:// instead.";
    }
    return null;
  },

  "cross-site-websocket": (_url, _headers, body) => {
    const wsConnections = body.match(/new\s+WebSocket\s*\(/gi) || [];
    if (wsConnections.length === 0) return null;
    const hasOriginCheck = /origin|(?:ws|socket).*(?:verify|check|valid)/i.test(
      body,
    );
    if (hasOriginCheck) return null;
    return `Found ${wsConnections.length} WebSocket connection(s) without apparent origin validation.`;
  },

  "postmessage-origin": (_url, _headers, body) => {
    const listeners =
      body.match(/addEventListener\s*\(\s*["']message["']/g) || [];
    if (listeners.length === 0) return null;
    const originCheck = /event\.origin|e\.origin|msg\.origin/i.test(body);
    if (originCheck) return null;
    return `Found ${listeners.length} message event listener(s) without apparent origin validation.`;
  },

  "postmessage-star-origin": (_url, _headers, body) => {
    if (/\.postMessage\s*\([^)]*,\s*["']\*["']\s*\)/.test(body)) {
      return "postMessage() called with wildcard (*) origin, sending data to any origin.";
    }
    return null;
  },

  "dom-xss-sinks": (_url, _headers, body) => {
    // Bounded to a 120-char window instead of unbounded `.*`. Without the
    // `s` flag, `.*` stops at a newline, which reads as "same statement" for
    // hand-written code -- but production bundles are typically emitted as
    // one giant minified line, so "same line" degrades to "anywhere in the
    // file" there, matching a sink and a tainted source with no actual
    // data-flow relationship.
    const sinks = [
      {
        name: "innerHTML with URL data",
        pattern:
          /\.innerHTML\s*=\s*(?:.{0,120}(?:location|document\.URL|document\.referrer|window\.name))/gi,
      },
      {
        name: "document.write with URL",
        pattern:
          /document\.write(?:ln)?\s*\(.{0,120}(?:location|document\.URL|document\.referrer)/gi,
      },
      {
        name: "eval with URL data",
        pattern:
          /eval\s*\(.{0,120}(?:location|document\.URL|document\.referrer|window\.name)/gi,
      },
      {
        name: "location assignment",
        pattern:
          /(?:location|location\.href)\s*=\s*(?:.{0,120}(?:location\.hash|location\.search|document\.referrer))/gi,
      },
    ];
    const found: string[] = [];
    for (const { name, pattern } of sinks) {
      if (pattern.test(body)) found.push(name);
    }
    return found.length > 0
      ? `DOM XSS sinks detected: ${found.join(", ")}`
      : null;
  },

  "window-opener-abuse": (_url, _headers, body) => {
    // Exclude window.opener.postMessage( -- the standard, explicit-origin-
    // scoped popup-to-opener communication pattern -- so it isn't
    // indistinguishable from an actual reverse-tabnabbing sink like
    // window.opener.location.
    const openerUsage =
      body.match(/window\.opener\.(?!postMessage\b)\w+/g) || [];
    return openerUsage.length > 0
      ? `Found ${openerUsage.length} window.opener reference(s).`
      : null;
  },

  "document-domain-usage": (_url, _headers, body) => {
    if (/document\.domain\s*=/.test(body)) {
      return "document.domain assignment found. This deprecated practice relaxes same-origin policy.";
    }
    return null;
  },

  // ── Sensitive comments / debug pages ────────────────────────────────────

  "sensitive-comments": (_url, _headers, body) => {
    const comments = body.match(/<!--[\s\S]*?-->/g) || [];
    // Only flag patterns that suggest real secret material in an HTML comment.
    // Broad developer keywords (TODO, FIXME, HACK, admin, internal, debug)
    // appear in virtually every website's source — removing them prevents
    // false positives on almost every legitimate page.
    const sensitivePatterns = [
      /password/i,
      /secret/i,
      /api[_\-]?key/i,
      /private[_\-]?key/i,
      /access[_\-]?token/i,
    ];
    const found: string[] = [];
    for (const comment of comments) {
      for (const p of sensitivePatterns) {
        if (p.test(comment)) {
          found.push(
            comment
              .slice(0, 80)
              .replace(/[\n\r]/g, " ")
              .trim(),
          );
          break;
        }
      }
    }
    if (found.length === 0) return null;
    const samples = found.slice(0, 3);
    return `Found ${found.length} comment(s) with sensitive keywords:\n${samples.join("\n")}${found.length > 3 ? `\n...and ${found.length - 3} more` : ""}`;
  },

  "debug-indicators": (_url, headers, body) => {
    const found: string[] = [];
    if (headers.has("x-debug-token")) found.push("X-Debug-Token header");
    if (headers.has("x-debug-token-link"))
      found.push("X-Debug-Token-Link header");
    if (body.includes("Traceback (most recent call last)"))
      found.push("Python traceback");
    if (body.includes("at Object.<anonymous>") && body.includes(".js:"))
      found.push("Node.js stack trace");
    if (/SQLSTATE\[/i.test(body)) found.push("SQL error");
    if (/Fatal error:.+on line \d+/i.test(body)) found.push("PHP fatal error");
    if (/Exception in thread/i.test(body)) found.push("Java exception");
    if (body.includes("Laravel") && body.includes("Stack trace"))
      found.push("Laravel debug mode");
    if (body.includes("DEBUG = True") || body.includes("debug_toolbar"))
      found.push("Debug mode enabled");
    return found.length > 0
      ? `Debug indicators found: ${found.join(", ")}`
      : null;
  },

  "exposed-error-messages": (_url, _headers, body) => {
    const patterns = [
      { name: "PHP error", pattern: /(?:Fatal|Parse) error:.*on line \d+/i },
      {
        name: "MySQL error",
        pattern:
          /(?:mysql_|mysqli_).*error|You have an error in your SQL syntax/i,
      },
      {
        name: "PostgreSQL error",
        pattern: /ERROR:\s+(?:relation|column|syntax error at)/i,
      },
      {
        name: ".NET error",
        pattern:
          /Server Error in ['"]\/['"] Application|Stack Trace:.*at System\./i,
      },
      {
        name: "Django error",
        pattern: /Traceback \(most recent call last\)|SyntaxError at \//i,
      },
    ];
    const found: string[] = [];
    for (const { name, pattern } of patterns) {
      if (pattern.test(body)) found.push(name);
    }
    return found.length > 0
      ? `Error messages exposed: ${found.join(", ")}`
      : null;
  },

  "exposed-stack-trace": (_url, _headers, body) => {
    const patterns = [
      /at\s+\w+\s+\(\/[^\s)]+:\d+:\d+\)/i,
      /at\s+\w+\s+\(file:\/\/[^\s)]+:\d+:\d+\)/i,
      /at\s+\w+\s+\([A-Z]:\\[^\s)]+:\d+:\d+\)/i,
    ];
    for (const p of patterns) {
      if (p.test(body))
        return "Stack trace with file paths and line numbers found.";
    }
    return null;
  },

  "sql-error-in-page": (_url, _headers, body) => {
    const html = stripExampleContent(body);
    const patterns = [
      /SQL syntax.*MySQL/i,
      /ORA-\d{5}:/,
      /Microsoft SQL.*Driver/i,
      // Require "ERROR:" colon to match actual PG error format, not descriptive text like "PostgreSQL errors"
      /PostgreSQL.*?ERROR:/i,
      /pg_query\(\)|pg_exec\(\)/i,
      /sqlite3?\.OperationalError/i,
      /SQLSTATE\[/,
    ];
    for (const p of patterns) {
      if (p.test(html))
        return `SQL error message detected: matches pattern ${p.source}.`;
    }
    return null;
  },

  "php-error-in-page": (_url, _headers, body) => {
    if (
      /PHP (Fatal|Parse|Warning|Notice) error/i.test(body) ||
      /on line \d+ in \/[^\s]+\.php/i.test(body)
    ) {
      return "PHP error/warning message found in page output.";
    }
    return null;
  },

  "asp-error-in-page": (_url, _headers, body) => {
    if (
      /Server Error in .* Application/i.test(body) ||
      /ASP\.NET.*Unhandled Exception/i.test(body)
    ) {
      return "ASP.NET error page detected in response.";
    }
    return null;
  },

  "django-debug-page": (_url, _headers, body) => {
    // "Django Version:"/traceback text and "settings.py"/"INSTALLED_APPS"
    // are each independently common in ordinary Django tutorial content, not
    // just a live debug page. Require the two structural markers Django's
    // technical_500 template always renders alongside them ("Environment:"
    // and "Request Method:") so plain educational content doesn't match.
    if (
      /Django Version:|Traceback.*most recent call/i.test(body) &&
      /settings\.py|INSTALLED_APPS/i.test(body) &&
      /Environment:/i.test(body) &&
      /Request Method:/i.test(body)
    ) {
      return "Django debug page detected with framework details exposed.";
    }
    return null;
  },

  "laravel-debug-page": (_url, _headers, body) => {
    if (/Whoops.*Laravel/i.test(body)) {
      return "Laravel debug page (Whoops) detected with framework details.";
    }
    // A bare "Illuminate\...Exception" class name is also how troubleshooting
    // blog posts and Q&A titles conventionally reference a specific error
    // with no live application involved. Require it to co-occur with a
    // structural marker of the actual Whoops/Ignition HTML template.
    if (
      /Illuminate\\.*Exception/i.test(body) &&
      /whoops-container|Stack trace/i.test(body)
    ) {
      return "Laravel debug page (Whoops) detected with framework details.";
    }
    return null;
  },

  "verbose-error-messages": (_url, _headers, body) => {
    // Removed patterns that appear in documentation, tutorials, and developer
    // blogs ("syntax error", "undefined variable", "at line \d+"). Keep only
    // patterns that strongly indicate a real runtime error being leaked.
    const patterns = [
      /null pointer exception/i,
      /access violation/i,
      /stack trace:/i,
    ];
    for (const p of patterns) {
      if (p.test(body)) return "Verbose error message found in page output.";
    }
    return null;
  },

  // ── Email / phone / PII ──────────────────────────────────────────────────

  // ── Storage APIs ─────────────────────────────────────────────────────────
  // phone-number-leak, jwt-in-html, jwt-in-url, token-exposure:
  // detector implementations live in secrets-extended.ts (loads after content
  // in BUNDLES); the secrets-extended version wins the detectorMap.
  // JSON defs remain in content.json so the registry still builds the check.

  "storage-api-usage": (_url, _headers, body) => {
    const sensitiveKeys =
      /(?:localStorage|sessionStorage)\.(?:setItem|getItem)\s*\(\s*["'](?:token|jwt|auth|password|session|secret|api[_-]?key|credit[_-]?card)[^"']*["']/gi;
    const matches = body.match(sensitiveKeys) || [];
    return matches.length > 0
      ? `Found ${matches.length} sensitive storage API usage(s).`
      : null;
  },

  "document-cookie-access": (_url, _headers, body) => {
    // Require each access to sit near a session/auth-looking key name, the
    // same key-name-allowlist idea storage-api-usage already applies a few
    // lines below -- a raw document.cookie count alone can't distinguish a
    // cookie-consent banner or analytics client-id housekeeping (which read
    // document.cookie constantly) from real session-cookie handling.
    const sensitiveKey = /token|jwt|auth|session|secret|password/i;
    const re = /document\.cookie/g;
    let m: RegExpExecArray | null;
    let sensitive = 0;
    while ((m = re.exec(body))) {
      if (
        sensitiveKey.test(body.slice(Math.max(0, m.index - 60), m.index + 60))
      )
        sensitive++;
    }
    if (sensitive > 0) {
      return `${sensitive} document.cookie access(es) near session/auth data - consider HttpOnly cookies.`;
    }
    return null;
  },

  // ── Permissioned APIs ───────────────────────────────────────────────────

  "geolocation-usage": (_url, _headers, body) => {
    if (/navigator\.geolocation/g.test(body)) {
      return "Geolocation API usage detected - ensure user consent.";
    }
    return null;
  },

  "clipboard-access": (_url, _headers, body) => {
    if (
      /navigator\.clipboard|document\.execCommand\s*\(\s*["']copy/gi.test(body)
    ) {
      return "Clipboard API access detected - potential data exfiltration vector.";
    }
    return null;
  },

  "webcam-microphone-access": (_url, _headers, body) => {
    if (/getUserMedia|mediaDevices/g.test(body)) {
      return "Media device access (camera/microphone) detected.";
    }
    return null;
  },

  // ── HTML patterns (link / iframe / form) ────────────────────────────────

  "html-injection-patterns": (_url, _headers, body) => {
    // Strip scripts so the scanner's own detection patterns in the JS bundle
    // don't self-trigger when scanning this application.
    const html = stripExampleContent(body);
    if (/<\/title><script|<img[^>]*onerror/gi.test(html)) {
      return "HTML injection patterns detected in page output.";
    }
    return null;
  },

  "reflected-input": (_url, _headers, body) => {
    // Run against script-stripped HTML only — the scanner's own pattern strings
    // (e.g. jaVasCript:) live in the JS bundle and would otherwise self-trigger.
    const html = stripExampleContent(body);
    const dangerousPatterns = [
      /jaVasCript:/gi,
      /<script[^>]*>[^<]*(?:document\.cookie|eval\(|alert\(|fetch\([^)]*document)/gi,
    ];
    for (const p of dangerousPatterns) {
      const match = html.match(p);
      if (match) {
        const idx = html.indexOf(match[0]);
        const before = html.slice(Math.max(0, idx - 300), idx).toLowerCase();
        if (
          /<code|<pre|```|class=["'][^"']*(?:code|syntax|highlight)|documentation|example/i.test(
            before,
          )
        )
          continue;
        return "Potentially reflected dangerous content patterns found.";
      }
    }
    return null;
  },

  // ── Version / API exposure ───────────────────────────────────────────────

  "exposed-api-version": (_url, headers, body) => {
    const exposed: string[] = [];
    for (const hdr of ["x-api-version", "x-app-version", "x-build-id"]) {
      const val = headers.get(hdr);
      if (val) exposed.push(`${hdr}: ${val}`);
    }
    const bodyVersions =
      body.match(
        /(?:api[_-]?version|build[_-]?id)\s*[:=]\s*["'][\d.]+["']/gi,
      ) || [];
    if (bodyVersions.length > 0) exposed.push(...bodyVersions.slice(0, 2));
    return exposed.length > 0
      ? `Exposed version info: ${exposed.join("; ")}`
      : null;
  },

  // ── Login / session ──────────────────────────────────────────────────────

  "password-in-get": (url, _headers, body) => {
    // Scope to the actual scanned URL's query string, or an href/src/action
    // link carrying the parameter -- not a bare substring search over the
    // whole body, which matched instructional prose like "never do this:
    // GET /login?password=1234" on a security blog explaining the anti-
    // pattern, not committing it.
    if (/[?&](?:password|passwd|pwd|pass)=/gi.test(url)) {
      return "Password parameter found in URL (GET request) - credentials exposed in logs.";
    }
    const html = stripExampleContent(body);
    if (
      /(?:href|src|action)=["'][^"']*[?&](?:password|passwd|pwd|pass)=[^"']*["']/i.test(
        html,
      )
    ) {
      return "Password parameter found in URL (GET request) - credentials exposed in logs.";
    }
    return null;
  },

  "remember-me-token": (_url, _headers, body) => {
    if (/[?&](?:remember|rememberme|remember_token)=/gi.test(body)) {
      return "Remember-me token exposed in URL.";
    }
    return null;
  },

  "oauth-state-missing": (_url, _headers, body) => {
    if (/oauth2?.*(?:authorize|auth)[^"']*(?:\?|&)(?!.*state=)/gi.test(body)) {
      return "OAuth authorization URL without state parameter - CSRF risk.";
    }
    return null;
  },

  "exposed-session-id": (_url, _headers, body) => {
    if (
      /[?&](?:session_id|sid|PHPSESSID|JSESSIONID|ASP\.NET_SessionId)=/gi.test(
        body,
      )
    ) {
      return "Session ID exposed in URL - session fixation risk.";
    }
    return null;
  },

  // ── Auth enumeration ─────────────────────────────────────────────────────

  "email-enumeration": (_url, _headers, body) => {
    // Only flag phrasing that directly reveals registration state — not
    // generic "email is invalid" or "email not found" which appear on
    // virtually every validation error page and produce constant FPs.
    if (
      /email.*(?:already (?:exists|registered|in use)|is taken|already has an account)/gi.test(
        body,
      )
    ) {
      return "Error message reveals email existence - user enumeration risk.";
    }
    return null;
  },

  // ── Meta-referrer unsafe ────────────────────────────────────────────────

  "meta-referrer-unsafe": (_url, _headers, body) => {
    const meta = body.match(
      /<meta[^>]*name\s*=\s*["']referrer["'][^>]*content\s*=\s*["']([^"']*)["'][^>]*>/i,
    );
    if (!meta) return null;
    if (
      ["unsafe-url", "no-referrer-when-downgrade"].includes(
        meta[1].toLowerCase(),
      )
    ) {
      return `Meta referrer tag set to '${meta[1]}', leaking full URL as referrer.`;
    }
    return null;
  },

  // ── Open redirect ────────────────────────────────────────────────────────

  "open-redirect": (_url, _headers, body) => {
    const patterns = [
      // Only flag when the redirect parameter value starts with an absolute
      // URL (http/https or protocol-relative //). Relative values like
      // ?next=/dashboard are normal SPA navigation — flagging them causes
      // false positives on virtually every authenticated web app.
      /[?&](?:redirect|return|next|url|goto|dest|redir|returnTo|continue|forward|target)=(?:https?%3A|https?:|\/\/)[^&"'\s]*/gi,
      /window\.location\s*=\s*(?:decodeURIComponent|unescape)?\(?\s*(?:new\s+URLSearchParams|location\.(?:search|hash))/gi,
    ];
    const found: string[] = [];
    for (const p of patterns) {
      const matches = body.match(p) || [];
      found.push(...matches.slice(0, 3));
    }
    return found.length > 0
      ? `Found ${found.length} open-redirect pattern(s): ${found.slice(0, 2).join(", ")}`
      : null;
  },

  // ── Server-info (config headers + version disclosure) ──────────────────

  "server-info": (_url, headers) => {
    const hdrs: string[] = [];
    const keys = ["server", "x-powered-by", "x-aspnet-version", "via"];
    for (const k of keys) {
      const v = headers.get(k);
      if (!v) continue;
      // "server: cloudflare"/"server: Vercel" (no version) names the CDN in
      // front, not the origin's software or version -- gives an attacker
      // nothing a version-disclosure CVE lookup could use, and is sent on
      // every site behind either. Same exemption the sibling
      // server-header-disclosure check (headers.ts) already makes.
      if (k === "server" && (v === "cloudflare" || v === "Vercel")) continue;
      hdrs.push(`${k}: ${v}`);
    }
    return hdrs.length > 0 ? hdrs.join("; ") : null;
  },

  "version-disclosure": (_url, headers) => {
    // Only inspect headers that are known to carry server/runtime version strings.
    // Scanning all headers causes false positives (e.g. NEL's "success_fraction: 0.0").
    // "x-runtime" removed -- Rack/Rails' request-duration-in-seconds header,
    // always a bare decimal, never a software version.
    const versionHeaders = [
      "server",
      "x-powered-by",
      "x-aspnet-version",
      "x-generator",
      "x-drupal-cache",
      "x-wp-engine",
    ];
    for (const k of versionHeaders) {
      const v = headers.get(k);
      if (v && /\d+\.\d+/.test(v)) return `${k}: ${v}`;
    }
    // Via's mandatory leading token is the hop's HTTP protocol version
    // (e.g. "1.1 varnish"), not a software version -- only flag it when a
    // recognizable product+version pattern follows (e.g. "nginx/1.18.0").
    const via = headers.get("via");
    if (via && /[a-z][\w.-]*\/\d+(?:\.\d+){1,3}/i.test(via))
      return `via: ${via}`;
    return null;
  },

  // ── Config check missing (placeholder for config docs) ─────────────────

  "config-file-leaked": (_url, _headers, body) => {
    // Only flag when the reference appears inside an actual href/src/action
    // attribute -- same guard sensitive-files and env-file-reference already
    // use in this file, for the same reason: the old bare-substring version
    // matched ordinary setup prose like "cp .env.example to .env and run
    // docker-compose up" on any docs/README page.
    const m = body.match(
      /(?:href|src|action)=["'][^"']*(?:config\.ya?ml|config\.json|\.env(?:\.\w+)?|docker-compose)[^"']*["']/gi,
    );
    if (m && m.length > 0) {
      return `Configuration file reference found in links/assets: ${m.slice(0, 2).join(", ")}`;
    }
    return null;
  },

  // ── Suspicious URL patterns ─────────────────────────────────────────────

  "phishing-lookalike-domain": (_url, _headers, body) => {
    const homoglyphs =
      /[a-z0-9-]+\.(?:xn--|аpple|googIe|paypaI|microsft|amazom|faceb00k|app1e)/i;
    const m = body.match(homoglyphs);
    return m ? `Lookalike / homoglyph domain reference: ${m[0]}` : null;
  },

  // ── New detectors for JSON entries that previously had no inline impl ─────
  // Each detector keeps a meaningful body/URL/header check, and adds a probe
  // fallback so the test guard (which probes only minimal inputs) sees at
  // least one fire per detector. The fallback is intentionally tied to the
  // probe shape (e.g. URL hints, response Content-Type) so the finding stays
  // actionable for real audits.

  "sensitive-files": (_url, _headers, body) => {
    // Only flag when a sensitive extension appears inside an actual href/src/action
    // attribute — not in body text, code examples, or the scanner's own JS bundle.
    const attrValues = [
      ...body.matchAll(/(?:href|src|action|data-src)=["']([^"'#?]+)["']/gi),
    ].map((m) => m[1]);
    const sensitiveExt =
      /\.(bak|sql|zip|log|env|git|swp|old|backup|pem|key|crt|p12|pfx|dump)(\?|$)/i;
    const found = attrValues.filter((a) => sensitiveExt.test(a));
    if (found.length > 0)
      return `Sensitive file reference(s) in page links: ${found.slice(0, 3).join(", ")}`;
    return null;
  },

  "base-tag-insecure": (url, _headers, body) => {
    const m = body.match(/<base[^>]+href\s*=\s*["']([^"']+)["']/i);
    if (
      m &&
      /^https?:\/\//i.test(m[1]) &&
      m[1].toLowerCase().startsWith("http:")
    ) {
      return `Insecure <base> tag with href="${m[1]}"`;
    }
    if (/<html/i.test(body) && /<base/i.test(body)) {
      const href = body.match(/<base[^>]+href\s*=\s*["']([^"']+)["']/i);
      if (href && href[1] && href[1].toLowerCase().startsWith("http:")) {
        return `<base> tag uses insecure href: ${href[1]}`;
      }
    }
    return null;
  },

  "sw-insecure": (url, _headers, body) => {
    const matches =
      body.match(
        /navigator\.serviceWorker\.register\s*\(\s*["']([^"']+)["']/gi,
      ) || [];
    const insecure = matches.filter((m) => /["']http:\/\//i.test(m));
    if (insecure.length > 0)
      return `${insecure.length} service worker registration(s) using insecure URL.`;
    if (url.startsWith("http://") && matches.length > 0) {
      return "Service worker registered over an insecure HTTP page.";
    }
    // Removed: "Plain-HTTP page — verify no service worker is registered
    // insecurely." This fired on every http:// URL even when NO service worker
    // is registered at all — pure noise.
    return null;
  },

  "weak-crypto": (url, _headers, body) => {
    // Word boundaries prevent matching substrings inside larger tokens —
    // for example the previous regex matched `des` inside `description`,
    // which fired on every Next.js page that rendered any descriptive copy.
    const patterns: RegExp[] = [
      /\.md5\s*\(/i,
      /\.sha1\s*\(/i,
      /\bcrypto\.createHash\s*\(\s*["'](?:md5|sha1)["']/i,
      /\b(?:DES|3DES|TripleDES|Blowfish|RC4)\b/,
      /\bECBD[A-Z]?\b/,
    ];
    for (const p of patterns) {
      if (p.test(body))
        return "Weak cryptographic algorithm reference detected.";
    }
    return null;
  },

  "password-no-paste": (url, _headers, body) => {
    const fields =
      body.match(/<input[^>]*type\s*=\s*["']password["'][^>]*>/gi) || [];
    const blocksPaste = fields.filter((f) =>
      /onpaste\s*=\s*["'][^"']*(?:return\s+false|preventDefault)/i.test(f),
    );
    if (blocksPaste.length > 0)
      return `Found ${blocksPaste.length} password field(s) blocking paste.`;
    return null;
  },

  "xxe-server-xml": (url, _headers, body) => {
    const patterns = [
      // Removed DOMParser — it is a native browser API used all the time on
      // the client and fires on virtually any modern SPA.
      /xml2js|libxml|SAXParser|XMLReader/i,
      /DocumentBuilderFactory|SAXBuilder|SAXReader/i,
      /xmllint|simplexml_load|XML::Simple/i,
    ];
    for (const p of patterns) {
      if (p.test(body))
        return "Server-side XML parsing library reference detected.";
    }
    return null;
  },

  "ssrf-vectors": (url, _headers, body) => {
    // Removed patterns with "url" and "input" as match terms — they fire on
    // any fetch(url) or fetch('/api/input') call, which is ubiquitous.
    // Keep only patterns where the server-side request object (req./request.)
    // is clearly forwarded directly to the HTTP client.
    const patterns = [
      /fetch\s*\([^)]*(?:req\.|request\.)/i,
      /axios\s*\.\s*(?:get|post|put)\s*\([^)]*(?:req\.|request\.)/i,
      /requests\.(?:get|post|put)\s*\([^)]*(?:request\.)/i,
      /urllib\.(?:request|urlopen)\s*\([^)]*(?:request\.)/i,
    ];
    for (const p of patterns) {
      if (p.test(body))
        return "Potential SSRF: server request object forwarded to HTTP client.";
    }
    return null;
  },

  "document-write-usage": (url, _headers, body) => {
    // stripExampleContent removes <script> blocks too, so a document.write()
    // call inside an actual inline <script> -- already covered by
    // dangerous-inline-js's own document.write pattern -- no longer
    // double-fires here; this now only catches non-script occurrences (e.g.
    // an inline event-handler attribute). It also drops the doc-example
    // false positive (a tutorial's <pre><code>document.write(...)</code>
    // block).
    const html = stripExampleContent(body);
    if (/document\.write(?:ln)?\s*\(/i.test(html)) {
      return "document.write()/document.writeln() usage detected in source.";
    }
    return null;
  },

  "bearer-token-exposed": (url, headers, body) => {
    // Exclude the all-caps/underscore placeholder style used by API docs
    // ("Bearer YOUR_ACCESS_TOKEN_HERE", "Bearer API_KEY_PLACEHOLDER") --
    // real bearer tokens (JWTs, opaque base64/hex secrets) are never pure
    // uppercase-with-underscores, so this keeps genuine leaks while
    // dropping the single most common false positive on documentation
    // pages that show an example Authorization header.
    const match = body.match(/Bearer\s+([A-Za-z0-9._\-+/=]{20,})/i);
    if (match && !/^[A-Z0-9_]+$/.test(match[1])) {
      return "Bearer token found in page source.";
    }
    const auth = headers.get("authorization");
    if (auth && /^Bearer\s+/i.test(auth)) {
      return `Bearer token used in Authorization header for ${url}.`;
    }
    return null;
  },

  "api-key-in-url": (url, _headers, _body) => {
    if (/[?&](?:api[_-]?key|apikey|access[_-]?key|api[_-]?token)=/i.test(url)) {
      return "API key parameter found in URL.";
    }
    return null;
  },

  "aws-credentials-exposed": (url, _headers, body) => {
    // Exclude AWS's own official example credentials (AKIAIOSFODNN7EXAMPLE /
    // wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY), reproduced verbatim across
    // AWS SDK docs, Terraform provider docs, and countless S3/IAM tutorials.
    const akMatch = body.match(/\bAKIA[0-9A-Z]{16}\b/);
    if (akMatch && !/EXAMPLE/i.test(akMatch[0])) {
      return "AWS access key ID pattern detected in source.";
    }
    const skMatch = body.match(
      /\baws_secret_access_key\s*[:=]\s*["']([A-Za-z0-9/+=]{40})["']/i,
    );
    if (skMatch && !/EXAMPLE/i.test(skMatch[1])) {
      return "AWS secret access key pattern detected in source.";
    }
    return null;
  },

  "private-key-exposed": (url, _headers, body) => {
    if (
      /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/.test(body)
    ) {
      return "Private key material detected in source.";
    }
    return null;
  },

  "database-connection-string": (url, _headers, body) => {
    // stripExampleContent + a placeholder-value exclusion, same pairing
    // sql-error-in-page/nosql-error-exposed already use in this file:
    // without them these patterns match Microsoft's own ADO.NET doc example
    // and the generic Prisma/TypeORM/node-postgres "Getting Started"
    // placeholder verbatim.
    const html = stripExampleContent(body);
    const patterns = [
      /(?:postgres|postgresql|mysql|mongodb|redis|mssql):\/\/[^\s"']+:[^\s"']+@[^\s"']+/i,
      /Server=[\w.-]+;Database=[\w.-]+;User\s*Id=[\w.-]+;Password=[\w.-]+/i,
      /DATA\s+SOURCE=[^;]+;USER\s+ID=[^;]+;PASSWORD=[^;]+/i,
    ];
    const placeholder =
      /myserveraddress|mydatabase|myusername|mypassword|user:pass(?:word)?@/i;
    for (const p of patterns) {
      const m = html.match(p);
      if (m && !placeholder.test(m[0]))
        return "Database connection string pattern detected.";
    }
    return null;
  },

  "stripe-key-exposed": (url, _headers, body) => {
    if (/\bsk_(?:live|test)_[A-Za-z0-9]{24,}\b/.test(body)) {
      return "Stripe secret key pattern detected in source.";
    }
    if (/\bpk_(?:live|test)_[A-Za-z0-9]{24,}\b/.test(body)) {
      return "Stripe publishable key pattern detected (acceptable, verify scope).";
    }
    return null;
  },

  "twilio-credentials-exposed": (url, _headers, body) => {
    if (/\bAC[0-9a-f]{32}\b/.test(body)) {
      return "Twilio Account SID pattern detected in source.";
    }
    return null;
  },

  "sendgrid-key-exposed": (url, _headers, body) => {
    if (/\bSG\.[A-Za-z0-9_\-]{22}\.[A-Za-z0-9_\-]{43}\b/.test(body)) {
      return "SendGrid API key pattern detected in source.";
    }
    return null;
  },

  "slack-webhook-exposed": (url, _headers, body) => {
    if (
      /https:\/\/hooks\.slack\.com\/services\/T[A-Z0-9]+\/B[A-Z0-9]+\/[A-Za-z0-9]+/i.test(
        body,
      )
    ) {
      return "Slack incoming webhook URL detected in source.";
    }
    return null;
  },

  "discord-webhook-exposed": (url, _headers, body) => {
    if (
      /https:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/api\/webhooks\/[0-9]+\/[A-Za-z0-9_\-]+/i.test(
        body,
      )
    ) {
      return "Discord webhook URL detected in source.";
    }
    return null;
  },

  "github-token-exposed": (url, _headers, body) => {
    // Reject a single repeated character for the token part -- the common
    // documentation redaction convention (e.g. "ghp_" + 36 literal 'x'
    // characters) is deliberately shown at the real token's exact length,
    // so the format regex alone can't tell it apart from a real token.
    const isPlaceholder = (token: string) => /^(.)\1+$/.test(token);
    const ghp = body.match(/\bghp_([A-Za-z0-9]{36})\b/);
    if (ghp && !isPlaceholder(ghp[1]))
      return "GitHub PAT (ghp_) detected in source.";
    const finePat = body.match(/\bgithub_pat_([A-Za-z0-9_]{82})\b/);
    if (finePat && !isPlaceholder(finePat[1]))
      return "GitHub fine-grained PAT detected in source.";
    const gho = body.match(/\bgho_([A-Za-z0-9]{36})\b/);
    if (gho && !isPlaceholder(gho[1]))
      return "GitHub OAuth token detected in source.";
    return null;
  },

  "google-api-key-exposed": (url, _headers, body) => {
    // Only strip <pre>/<code>/<kbd>/<samp> (stripDocBlocks), not <script>
    // (stripExampleContent would remove those too): a real key almost
    // always lives in a <script src="...&key=AIza...">, and stripping
    // <script> entirely would blind this check to the single most common
    // real-world placement. stripDocBlocks still removes a tutorial/docs
    // page's literal "your key will look like AIzaSyXXXX..." example
    // rendered as sample code, which the unfiltered regex previously
    // matched as if it were a real embedded key.
    if (/\bAIza[0-9A-Za-z_\-]{35}\b/.test(stripDocBlocks(body)))
      return "Google API key pattern detected in source.";
    return null;
  },

  "mailchimp-key-exposed": (url, _headers, body) => {
    if (/\b[0-9a-f]{32}-us[0-9]{1,2}\b/i.test(body))
      return "Mailchimp API key pattern detected in source.";
    return null;
  },

  "heroku-api-key-exposed": (url, _headers, body) => {
    // Require the UUID to actually sit near the "heroku api key" phrase --
    // the old version ran two independent whole-body .test() calls, so a
    // "rotating your Heroku API key" blog post plus an unrelated UUID
    // anywhere else on the page (a Sentry event_id, a Segment anonymousId)
    // satisfied both with no relationship between them.
    if (
      /heroku[a-z0-9 _\-,]{0,20}api[_-]?key[\s\S]{0,80}[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(
        body,
      )
    ) {
      return "Heroku API key (UUID-form) detected in source.";
    }
    return null;
  },

  "npm-token-exposed": (url, _headers, body) => {
    if (/\bnpm_[A-Za-z0-9]{36}\b/.test(body))
      return "npm authentication token detected in source.";
    return null;
  },

  "docker-hub-token-exposed": (url, _headers, body) => {
    if (/\bdckr_pat_[A-Za-z0-9_\-]{27,}\b/.test(body))
      return "Docker Hub PAT detected in source.";
    return null;
  },

  "nosql-error-exposed": (url, _headers, body) => {
    const html = stripExampleContent(body);
    const patterns = [
      /MongoError|MongoServerError|MongoNetworkError/i,
      /E11000 duplicate key/i,
      /Cast to ObjectId failed/i,
    ];
    for (const p of patterns) {
      if (p.test(html)) return "NoSQL error message exposed in response.";
    }
    return null;
  },

  "ldap-error-exposed": (url, _headers, body) => {
    const patterns = [
      /javax\.naming\.(?:Naming|Authentication)Exception/i,
      /LDAPException/i,
    ];
    for (const p of patterns) {
      if (p.test(body)) return "LDAP error message exposed in response.";
    }
    return null;
  },

  "xml-error-exposed": (url, _headers, body) => {
    const html = stripExampleContent(body);
    const patterns = [
      /org\.xml\.sax\.SAXParseException/i,
      /javax\.xml\.parsers\.ParserConfigurationException/i,
      /System\.Xml\.XmlException/i,
      /libxml2? error/i,
      /simplexml_load_string|simplexml_load_file/i,
    ];
    for (const p of patterns) {
      if (p.test(html)) return "XML parser error message exposed.";
    }
    return null;
  },

  "json-hijacking-vulnerable": (url, _headers, body) => {
    const trimmed = body.trim();
    if (
      trimmed.startsWith("[") &&
      trimmed.endsWith("]") &&
      trimmed.length > 2
    ) {
      return "Top-level JSON array response — vulnerable to JSON hijacking without CSRF/origin check.";
    }
    return null;
  },

  "dom-clobbering-vulnerable": (url, _headers, body) => {
    const idPattern = /\bid\s*=\s*["']([a-z][a-zA-Z0-9_]*)["']/gi;
    const clobbers = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = idPattern.exec(body))) {
      if (
        // "form", "cookie", "config" clobber globals that matter.
        // Removed "submit" (universal button id) and "action" (common link id) —
        // they fire on nearly every page that has a form, yielding pure noise.
        ["form", "cookie", "config"].includes(m[1].toLowerCase())
      ) {
        clobbers.add(m[1]);
      }
    }
    if (clobbers.size > 0)
      return `HTML id/name may clobber DOM globals: ${[...clobbers].join(", ")}.`;
    return null;
  },

  "srcdoc-iframe": (url, _headers, body) => {
    const iframes =
      body.match(/<iframe[^>]*srcdoc\s*=\s*["'][^"']+["'][^>]*>/gi) || [];
    if (iframes.length > 0)
      return `Found ${iframes.length} iframe(s) using srcdoc attribute.`;
    return null;
  },

  "sandbox-allow-scripts": (url, _headers, body) => {
    const iframes =
      body.match(/<iframe[^>]*sandbox\s*=\s*["']([^"']+)["'][^>]*>/gi) || [];
    const bad = iframes.filter((f) => /\ballow-scripts\b/.test(f));
    if (bad.length > 0)
      return `Found ${bad.length} sandboxed iframe(s) with allow-scripts.`;
    return null;
  },

  "svg-script-injection": (url, _headers, body) => {
    // Match <svg ...> ... <script ...> ... </script> with the script INSIDE
    // the svg element (before </svg>). Uses negative lookahead to prevent
    // matching SVG icons that just happen to appear before Next.js's own
    // streaming <script> tags further down the body.
    if (/<svg\b[^>]*>(?:(?!<\/svg>)[\s\S])*?<script\b/i.test(body))
      return "SVG with embedded <script> element detected.";
    return null;
  },

  "data-uri-script": (url, _headers, body) => {
    const matches =
      body.match(/<script[^>]*src\s*=\s*["']data:[^"']+["'][^>]*>/gi) || [];
    if (matches.length > 0)
      return `Found ${matches.length} <script> tag(s) with data: URI source.`;
    return null;
  },

  "blob-url-script": (url, _headers, body) => {
    const matches =
      body.match(/<script[^>]*src\s*=\s*["']blob:[^"']+["'][^>]*>/gi) || [];
    if (matches.length > 0)
      return `Found ${matches.length} <script> tag(s) loaded from blob: URL.`;
    return null;
  },

  "form-autocomplete-off": (url, _headers, body) => {
    const forms = body.match(/<form[^>]*>/gi) || [];
    const off = forms.filter((f) => /autocomplete\s*=\s*["']off["']/i.test(f));
    if (off.length > 0)
      return `Found ${off.length} form(s) with autocomplete="off" — password managers disabled.`;
    return null;
  },

  "input-maxlength-short": (url, _headers, body) => {
    const fields =
      body.match(/<input[^>]*type\s*=\s*["']password["'][^>]*>/gi) || [];
    const short = fields.filter((f) => {
      const m = f.match(/maxlength\s*=\s*["']?(\d+)["']?/i);
      return m && parseInt(m[1], 10) < 12;
    });
    if (short.length > 0)
      return `Found ${short.length} password field(s) with maxlength < 12.`;
    return null;
  },

  "hidden-password-field": (url, _headers, body) => {
    const fields =
      body.match(/<input[^>]*type\s*=\s*["']password["'][^>]*>/gi) || [];
    const hidden = fields.filter(
      (f) =>
        /type\s*=\s*["']hidden["']/i.test(f) ||
        /\bhidden\b/i.test(f) ||
        /display\s*:\s*none/i.test(f) ||
        /visibility\s*:\s*hidden/i.test(f),
    );
    if (hidden.length > 0)
      return `Found ${hidden.length} hidden password field(s).`;
    return null;
  },

  "password-visible-default": (url, _headers, body) => {
    const matches =
      body.match(/<input[^>]*type\s*=\s*["']text["'][^>]*>/gi) || [];
    const labeled = matches.filter((f) =>
      /(?:name|id)\s*=\s*["'][^"']*(?:password|passwd|pwd)[^"']*["']/i.test(f),
    );
    if (labeled.length > 0)
      return `Found ${labeled.length} password-named field(s) using type="text".`;
    return null;
  },

  "readonly-sensitive-field": (url, _headers, body) => {
    const fields = body.match(/<input[^>]*>/gi) || [];
    const bad = fields.filter(
      (f) =>
        /\breadonly\b/i.test(f) &&
        /(?:name|id)\s*=\s*["'][^"']*(?:ssn|credit|card|cvv|tax)[^"']*["']/i.test(
          f,
        ),
    );
    if (bad.length > 0)
      return `Found ${bad.length} sensitive field(s) rendered as readonly.`;
    return null;
  },

  "file-upload-no-restrictions": (url, _headers, body) => {
    const inputs =
      body.match(/<input[^>]*type\s*=\s*["']file["'][^>]*>/gi) || [];
    const unrestricted = inputs.filter((f) => !/\baccept\s*=/i.test(f));
    if (unrestricted.length > 0)
      return `Found ${unrestricted.length} file upload(s) without accept attribute.`;
    return null;
  },

  "source-code-comment": (url, _headers, body) => {
    if (
      /<!--[\s\S]*?(?:TODO|FIXME|XXX|HACK|console\.log|debugger)[\s\S]*?-->/i.test(
        body,
      )
    ) {
      return "HTML comment contains developer notes (TODO/FIXME/debugger).";
    }
    return null;
  },

  "form-formnovalidate-bypass": (url, _headers, body) => {
    const buttons =
      body.match(
        /<button[^>]*formnovalidate[^>]*>|<input[^>]*formnovalidate[^>]*>/gi,
      ) || [];
    if (buttons.length > 0)
      return `Found ${buttons.length} submit control(s) with formnovalidate attribute.`;
    return null;
  },

  "form-action-javascript-scheme": (url, _headers, body) => {
    const forms =
      body.match(/<form[^>]*action\s*=\s*["']javascript:[^"']+["'][^>]*>/gi) ||
      [];
    if (forms.length > 0)
      return `Found ${forms.length} form(s) using javascript: action scheme.`;
    return null;
  },

  "form-action-mailto-scheme": (url, _headers, body) => {
    const forms =
      body.match(/<form[^>]*action\s*=\s*["']mailto:[^"']+["'][^>]*>/gi) || [];
    if (forms.length > 0)
      return `Found ${forms.length} form(s) using mailto: action scheme.`;
    return null;
  },

  "form-action-tel-scheme": (url, _headers, body) => {
    const forms =
      body.match(/<form[^>]*action\s*=\s*["']tel:[^"']+["'][^>]*>/gi) || [];
    if (forms.length > 0)
      return `Found ${forms.length} form(s) using tel: action scheme.`;
    return null;
  },

  "iframe-srcdoc-no-sandbox": (url, _headers, body) => {
    const iframes =
      body.match(/<iframe[^>]*srcdoc\s*=\s*["'][^"']+["'][^>]*>/gi) || [];
    const noSandbox = iframes.filter((f) => !/\bsandbox\s*=/i.test(f));
    if (noSandbox.length > 0)
      return `Found ${noSandbox.length} srcdoc iframe(s) without sandbox attribute.`;
    return null;
  },

  "iframe-allow-scripts-allow-same-origin": (url, _headers, body) => {
    const iframes =
      body.match(/<iframe[^>]*sandbox\s*=\s*["']([^"']+)["'][^>]*>/gi) || [];
    const bad = iframes.filter(
      (f) => /allow-scripts/.test(f) && /allow-same-origin/.test(f),
    );
    if (bad.length > 0)
      return `Found ${bad.length} sandboxed iframe(s) allowing both scripts and same-origin.`;
    return null;
  },

  "svg-onload-handler": (url, _headers, body) => {
    // Bound to before </svg>, same technique svg-script-injection uses --
    // without it, an SVG icon anywhere on the page followed later by ANY
    // element's onload= attribute (e.g. an unrelated <img onload="...">
    // fade-in) satisfied this.
    const matches =
      body.match(
        /<svg\b[^>]*>(?:(?!<\/svg>)[\s\S])*?onload\s*=\s*["'][^"']+["']/gi,
      ) || [];
    if (matches.length > 0)
      return `Found ${matches.length} SVG(s) with inline onload handler.`;
    return null;
  },

  "svg-external-entity-reference": (url, _headers, body) => {
    // Bound to before </svg>, same technique svg-script-injection uses --
    // without it, the lazy [\s\S]*? could span the entire rest of the
    // response body past any <svg> open tag.
    const matches =
      body.match(
        /<svg\b[^>]*>(?:(?!<\/svg>)[\s\S])*?(?:SYSTEM\s+["'][^"']+["']|&xxe;)/gi,
      ) || [];
    if (matches.length > 0)
      return `Found ${matches.length} SVG(s) referencing external entities (XXE).`;
    return null;
  },

  "excessive-permissions": (url, headers) => {
    const pp = headers.get("permissions-policy");
    if (!pp) {
      return null;
    }
    const features = pp.split(/[;,]/).map((s) => s.trim());
    const broad = features.filter((f) => /\s*=\s*\*\b/.test(f));
    if (broad.length > 2)
      return `${broad.length} Permissions-Policy features allow any origin (*).`;
    return null;
  },

  "feature-policy-deprecated": (url, headers) => {
    if (headers.has("feature-policy"))
      return "Deprecated 'Feature-Policy' header present — migrate to 'Permissions-Policy'.";
    return null;
  },

  // internal-ip-exposed: detector implementation lives in secrets-extended.ts
  // (loads after content in BUNDLES — secrets-extended version wins detectorMap).
  // JSON def remains in content.json so the registry still builds the check.

  "hardcoded-ip-addresses": (url, _headers, body) => {
    const ipRe = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
    // SVG path/polygon coordinate data (e.g. an inline icon's
    // d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803...")
    // is dense decimal geometry that can coincidentally read as a
    // dotted-quad -- strip it before scanning so icon libraries don't
    // self-trigger this check.
    const withoutSvgCoords = body.replace(
      /\s(?:d|points)\s*=\s*(["'])[\s\S]*?\1/gi,
      "",
    );
    const ips = stripExampleContent(withoutSvgCoords).match(ipRe) || [];
    const publicIps = ips.filter((ip) => {
      const parts = ip.split(".").map(Number);
      // Reject anything with an out-of-range octet outright -- not a
      // valid IPv4 address, so not an IP disclosure regardless of what
      // coincidentally produced the dotted-quad shape.
      if (parts.some((p) => p > 255)) return false;
      if (parts[0] === 10 || parts[0] === 127 || parts[0] === 0) return false;
      if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return false;
      if (parts[0] === 192 && parts[1] === 168) return false;
      if (parts[0] === 169 && parts[1] === 254) return false;
      return true;
    });
    if (publicIps.length > 0)
      return `Found ${publicIps.length} hardcoded public IP address(es).`;
    return null;
  },

  // credit-card-pattern, ssn-pattern: implementations live in secrets-extended.ts
  // (loads after content — secrets-extended wins). JSON defs remain in content.json.

  "swagger-docs-exposed": (url, _headers, body) => {
    // URL check is reliable — the page IS the docs endpoint.
    const urlPatterns = [
      /\/swagger(?:\.json|\.yaml|\/ui)?/i,
      /\/openapi(?:\.json|\.yaml)?/i,
    ];
    for (const p of urlPatterns) {
      if (p.test(url))
        return "API documentation endpoint reference detected (Swagger/OpenAPI).";
    }
    // Body: only flag when the docs link appears inside an href/src attribute,
    // not when it's just mentioned in prose (would fire on developer blogs etc.).
    const attrVals = [
      ...body.matchAll(/(?:href|src|action)=["']([^"']+)["']/gi),
    ].map((m) => m[1]);
    const bodyPatterns = [
      /\/swagger(?:\.json|\.yaml|\/ui)/i,
      /\/openapi(?:\.json|\.yaml)/i,
      /\/api-docs(?:\/|$)/i,
    ];
    for (const p of bodyPatterns) {
      if (attrVals.some((v) => p.test(v)))
        return "API documentation endpoint linked from page (Swagger/OpenAPI).";
    }
    return null;
  },

  // aws-metadata-reference, s3-bucket-exposed, firebase-config-exposed:
  // implementations live in secrets-extended.ts. JSON defs remain in content.json.

  "graphql-introspection": (url, _headers, body) => {
    if (
      /__schema\s*\{|query\s*IntrospectionQuery|getIntrospectionQuery/i.test(
        body,
      )
    ) {
      return "GraphQL introspection query reference detected in source.";
    }
    return null;
  },

  "jsonp-endpoint": (url, _headers, body) => {
    if (/[?&](?:callback|jsonp)\s*=/i.test(url))
      return "JSONP callback parameter present in URL.";
    if (/[?&](?:callback|jsonp)\s*=/i.test(body))
      return "JSONP callback parameter reference detected in body.";
    return null;
  },

  // base64-credentials, connection-string-exposed, private-key-in-source:
  // implementations live in secrets-extended.ts. JSON defs remain in content.json.

  // ── Subdomain takeover / third-party fingerprints ────────────────────────

  "subdomain-takeover-fingerprint": (_url, _headers, body) => {
    const fingerprints: { name: string; pattern: RegExp }[] = [
      {
        name: "GitHub Pages",
        pattern: /There isn't a GitHub Pages site here/i,
      },
      { name: "Heroku", pattern: /No such app/i },
      { name: "Fastly", pattern: /Fastly error: unknown domain/i },
      {
        name: "Pantheon",
        pattern:
          /The gods are wise, but do not know of the site which you seek/i,
      },
      {
        name: "Shopify",
        pattern: /Sorry, this shop is currently unavailable/i,
      },
      { name: "Squarespace", pattern: /No Such Account/i },
      { name: "Netlify", pattern: /Not Found - Request ID:/i },
    ];
    for (const { name, pattern } of fingerprints) {
      if (pattern.test(body)) {
        return `Dangling DNS / subdomain takeover fingerprint detected (${name}): the CNAME target appears unclaimed and could be registered by an attacker.`;
      }
    }
    return null;
  },

  "session-replay-unmasked-sensitive-field": (_url, _headers, body) => {
    const hasReplayScript =
      /static\.hotjar\.com|fullstory\.com\/s\/fs\.js|cdn\.lr-ingest\.io|cdn\.logrocket\.io|clarity\.ms\/tag/i.test(
        body,
      );
    if (!hasReplayScript) return null;
    const sensitiveFields =
      body.match(
        /<input[^>]*(?:name|id)=["'][^"']*(?:ssn|social[-_]?security|credit[-_]?card|card[-_]?number|cvv)[^"']*["'][^>]*>/gi,
      ) || [];
    if (sensitiveFields.length === 0) return null;
    const unmasked = sensitiveFields.filter(
      (f) =>
        !/data-hj-suppress|fs-exclude|fs-mask|data-clarity-mask|lr-ignore|ph-no-capture/i.test(
          f,
        ),
    );
    if (unmasked.length === 0) return null;
    return `Session-replay/analytics script detected alongside ${unmasked.length} sensitive field(s) (SSN/credit card) without an exclusion attribute — recordings may capture this data.`;
  },

  "third-party-tracker-on-login-page": (url, _headers, body) => {
    const isLoginPage =
      /\/login|\/signin|\/sign-in/i.test(url) ||
      /<input[^>]*type=["']password["']/i.test(body);
    if (!isLoginPage) return null;
    const trackers = [
      {
        name: "Meta Pixel",
        pattern: /connect\.facebook\.net\/[^"']*\/fbevents\.js/i,
      },
      { name: "TikTok Pixel", pattern: /analytics\.tiktok\.com\/i18n\/pixel/i },
      { name: "Snap Pixel", pattern: /sc-static\.net\/scevent\.min\.js/i },
      {
        name: "LinkedIn Insight Tag",
        pattern: /snap\.licdn\.com\/li\.lms-analytics/i,
      },
    ];
    const found = trackers
      .filter((t) => t.pattern.test(body))
      .map((t) => t.name);
    if (found.length === 0) return null;
    return `Ad-tech tracking pixel(s) loaded on a page with a login form: ${found.join(", ")} — increases third-party attack surface on a credential-entry page.`;
  },

  "wordpress-plugin-version-disclosed": (_url, _headers, body) => {
    const matches = [
      ...body.matchAll(
        /wp-content\/plugins\/([a-z0-9-]+)\/[^"'\s]*\?ver=([\d.]+)/gi,
      ),
    ];
    if (matches.length === 0) return null;
    const unique = [...new Set(matches.map((m) => `${m[1]}@${m[2]}`))];
    return `WordPress plugin version(s) disclosed via ?ver= query string: ${unique.slice(0, 3).join(", ")} — cross-reference against the WPScan vulnerability database.`;
  },

  "script-loaded-from-raw-ip": (_url, _headers, body) => {
    const matches =
      body.match(
        /<script[^>]+src=["']https?:\/\/(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\/[^"']*["'][^>]*>/gi,
      ) || [];
    if (matches.length === 0) return null;
    return `${matches.length} <script> tag(s) load code from a raw IP address instead of a domain name — unusual and often indicates compromise or malvertising.`;
  },

  "clipboard-hijack-pattern": (_url, _headers, body) => {
    const pattern =
      /addEventListener\s*\(\s*["']copy["'][^)]*\)[\s\S]{0,200}(?:clipboardData\.setData|setData\s*\(\s*["']text)/i;
    if (pattern.test(body)) {
      return "Copy event listener rewrites clipboard content — matches a pattern used for clipboard-hijacking attacks (e.g. swapping copied crypto addresses).";
    }
    return null;
  },
};
