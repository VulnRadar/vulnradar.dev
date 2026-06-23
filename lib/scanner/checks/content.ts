/**
 * Content / page-structure detectors.
 *
 * Inspects the response body for HTML and JS issues that aren't quite
 * code (which lives in code.ts), cookies (cookies.ts), or secrets
 * (secrets-extended.ts). Examples: SRI on external assets, mixed
 * content, iframe sandboxing, deprecated HTML, accessibility.
 */

import { type EvidenceFn as DetectFn } from "../_helpers";

export const detectors: Record<string, DetectFn> = {
  // ── Mixed content / transport ────────────────────────────────────────────

  "mixed-content": (url, _headers, body) => {
    if (!url.startsWith("https://")) return null;
    const httpRefs =
      body.match(
        /(?:src|href|action)=["']http:\/\/(?!localhost)[^"']+["']/gi,
      ) || [];
    if (httpRefs.length === 0) return null;
    const samples = httpRefs
      .slice(0, 3)
      .map((r) =>
        r.replace(/^(?:src|href|action)=["']/i, "").replace(/["']$/, ""),
      );
    return `Found ${httpRefs.length} HTTP resource(s) on HTTPS page:\n${samples.join("\n")}${httpRefs.length > 3 ? `\n...and ${httpRefs.length - 3} more` : ""}`;
  },

  "mixed-content-form-action": (url, _headers, body) => {
    if (!url.startsWith("https://")) return null;
    if (/<form[^>]*action\s*=\s*["']http:\/\//i.test(body)) {
      return "HTTPS page contains form submitting to HTTP endpoint.";
    }
    return null;
  },

  "form-action-http": (url, _headers, body) => {
    if (!url.startsWith("https://")) return null;
    const httpForms =
      body.match(/<form[^>]*action=["']http:\/\/[^"']+["'][^>]*>/gi) || [];
    return httpForms.length > 0
      ? `Found ${httpForms.length} form(s) submitting over HTTP.`
      : null;
  },

  // ── SRI ──────────────────────────────────────────────────────────────────

  "sri-missing": (_url, _headers, body) => {
    const externalScripts =
      body.match(/<script[^>]+src=["']https?:\/\/[^"']+["'][^>]*>/gi) || [];
    const noSRI = externalScripts.filter(
      (t) => !t.toLowerCase().includes("integrity="),
    );
    if (noSRI.length === 0) return null;
    const samples = noSRI.slice(0, 3).map((t) => {
      const srcMatch = t.match(/src=["'](https?:\/\/[^"']+)["']/i);
      return srcMatch ? srcMatch[1] : t.slice(0, 80);
    });
    return `Found ${noSRI.length} external script(s) without integrity:\n${samples.join("\n")}${noSRI.length > 3 ? `\n...and ${noSRI.length - 3} more` : ""}`;
  },

  "sri-stylesheet-missing": (_url, _headers, body) => {
    const extStyles =
      body.match(
        /<link[^>]+rel=["']stylesheet["'][^>]+href=["']https?:\/\/[^"']+["'][^>]*>/gi,
      ) || [];
    const noSRI = extStyles.filter(
      (t) => !t.toLowerCase().includes("integrity="),
    );
    return noSRI.length > 0
      ? `Found ${noSRI.length} external stylesheet(s) without integrity attribute.`
      : null;
  },

  "external-script-no-sri": (_url, _headers, body) => {
    const scripts =
      body.match(/<script[^>]*src\s*=\s*["'][^"']*["'][^>]*>/gi) || [];
    let missing = 0;
    for (const s of scripts) {
      if (/src\s*=\s*["']https?:\/\//i.test(s) && !s.includes("integrity"))
        missing++;
    }
    if (missing < 1) return null;
    return `${missing} external script(s) loaded without Subresource Integrity (SRI) hash.`;
  },

  "sri-link-stylesheet-missing": (_url, _headers, body) => {
    const links =
      body.match(/<link[^>]*rel\s*=\s*["']stylesheet["'][^>]*>/gi) || [];
    let missing = 0;
    for (const l of links) {
      if (/href\s*=\s*["']https?:\/\//i.test(l) && !l.includes("integrity"))
        missing++;
    }
    if (missing < 1) return null;
    return `${missing} external stylesheet(s) loaded without SRI integrity hash.`;
  },

  // ── iframes ──────────────────────────────────────────────────────────────

  "insecure-iframes": (url, _headers, body) => {
    if (!url.startsWith("https://")) return null;
    const httpIframes =
      body.match(/<iframe[^>]+src=["']http:\/\/[^"']+["'][^>]*>/gi) || [];
    return httpIframes.length > 0
      ? `Found ${httpIframes.length} iframe(s) loading HTTP content on HTTPS page.`
      : null;
  },

  "iframe-no-sandbox": (_url, _headers, body) => {
    const iframes = body.match(/<iframe[^>]*>/gi) || [];
    let unsandboxed = 0;
    for (const f of iframes) {
      if (!f.includes("sandbox")) unsandboxed++;
    }
    if (unsandboxed < 1) return null;
    return `${unsandboxed} iframe(s) found without sandbox attribute.`;
  },

  "iframe-sandbox-missing": (_url, _headers, body) => {
    const iframes = body.match(/<iframe[^>]*src=["'][^"']+["'][^>]*>/gi) || [];
    const noSandbox = iframes.filter(
      (t) => !t.toLowerCase().includes("sandbox"),
    );
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
    const noCsrf = postForms.filter(
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
    const forms = body.match(/<form[^>]*>/gi) || [];
    for (const f of forms) {
      if (/method\s*=\s*["']?get/i.test(f) || !f.includes("method")) {
        const after = body.substring(body.indexOf(f), body.indexOf(f) + 500);
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
        /<input[^>]*(?:name|id)=["'][^"']*(?:card|credit|cc)[^"']*["'][^>]*>/gi,
      ) || [];
    const noAC = [...pwFields, ...ccFields].filter(
      (f) => !/autocomplete\s*=/i.test(f),
    );
    return noAC.length > 0
      ? `Found ${noAC.length} sensitive field(s) without autocomplete attribute.`
      : null;
  },

  "autocomplete-sensitive-fields": (_url, _headers, body) => {
    const inputs =
      body.match(
        /<input[^>]*type\s*=\s*["']?(password|email|tel|number)[^>]*>/gi,
      ) || [];
    let missing = 0;
    for (const i of inputs) {
      if (!i.includes("autocomplete")) missing++;
    }
    if (missing < 2) return null;
    return `${missing} sensitive input field(s) missing autocomplete attribute.`;
  },

  "password-input-no-name": (_url, _headers, body) => {
    const pwInputs =
      body.match(/<input[^>]*type=["']password["'][^>]*>/gi) || [];
    const noAttrs = pwInputs.filter(
      (t) => !/autocomplete\s*=\s*["']/i.test(t) && !/name\s*=\s*["']/i.test(t),
    );
    return noAttrs.length > 0
      ? `Found ${noAttrs.length} password field(s) missing name or autocomplete.`
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

  "password-paste-disabled": (_url, _headers, body) => {
    const noPaste =
      body.match(
        /<input[^>]*type=["']password["'][^>]*onpaste=["'].*(?:return false|preventDefault)[^"']*["']/gi,
      ) || [];
    return noPaste.length > 0
      ? `Found ${noPaste.length} password field(s) blocking paste. This harms security.`
      : null;
  },

  // ── HTML structure / accessibility ───────────────────────────────────────

  "html-lang-missing": (_url, _headers, body) => {
    const htmlTag = body.match(/<html[^>]*>/i);
    if (htmlTag && !/lang\s*=/i.test(htmlTag[0]))
      return "The <html> tag does not include a lang attribute.";
    return null;
  },

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

  "lazy-loading-missing": (_url, _headers, body) => {
    const imgs = body.match(/<img[^>]*src=["'][^"']+["'][^>]*>/gi) || [];
    const noLazy = imgs.filter((t) => !/loading\s*=\s*["']lazy["']/i.test(t));
    return noLazy.length > 5
      ? `Found ${noLazy.length} image(s) without loading='lazy'.`
      : null;
  },

  "input-no-maxlength": (_url, _headers, body) => {
    const inputs =
      body.match(
        /<input[^>]*type=["'](?:text|email|search|tel|url)["'][^>]*>/gi,
      ) || [];
    const textareas = body.match(/<textarea[^>]*>/gi) || [];
    const noMax = [...inputs, ...textareas].filter(
      (t) => !/maxlength\s*=/i.test(t),
    );
    return noMax.length > 3
      ? `Found ${noMax.length} input(s) without maxlength.`
      : null;
  },

  // ── Service worker / open graph / redirect ──────────────────────────────

  "service-worker-scope": (_url, _headers, body) => {
    const swReg =
      body.match(
        /navigator\.serviceWorker\.register\s*\(\s*["']([^"']+)["']/gi,
      ) || [];
    if (swReg.length === 0) return null;
    const wide = swReg.filter(
      (r) => /scope\s*:\s*["']\/["']/i.test(r) || !/scope/i.test(r),
    );
    return wide.length > 0
      ? "Service worker registered with broad scope."
      : null;
  },

  "opengraph-injection": (_url, _headers, body) => {
    const ogTags =
      body.match(
        /<meta[^>]*property=["']og:[^"']+["'][^>]*content=["']([^"']+)["']/gi,
      ) || [];
    const suspicious = ogTags.filter((t) =>
      /javascript:|data:|on\w+=/i.test(t),
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

  "preconnect-third-party": (_url, _headers, body) => {
    const domains = new Set<string>();
    const srcMatches =
      body.match(/(?:src|href)=["']https?:\/\/([^"'/]+)/gi) || [];
    for (const m of srcMatches) {
      const d = m.match(/https?:\/\/([^"'/]+)/i);
      if (d) domains.add(d[1].toLowerCase());
    }
    return domains.size > 10
      ? `Connections to ${domains.size} third-party domains.`
      : null;
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
    const found = metas.filter((m) =>
      sensitiveNames.some((s) => m.toLowerCase().includes(s)),
    );
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

  "source-maps": (_url, _headers, body) => {
    const mapRefs = body.match(/\/\/[#@]\s*sourceMappingURL=[^\s]+/g) || [];
    const mapFiles = body.match(/\.js\.map/g) || [];
    const total = mapRefs.length + mapFiles.length;
    return total > 0 ? `Found ${total} source map reference(s).` : null;
  },

  // ── Third-party / outdated libs ──────────────────────────────────────────

  "outdated-js-libs": (_url, _headers, body) => {
    const libs: { name: string; pattern: RegExp; maxSafe: string }[] = [
      {
        name: "jQuery < 3.5.0",
        pattern: /jquery[./\-]([123]\.\d+\.\d+)/i,
        maxSafe: "3.5.0",
      },
      {
        name: "Angular.js 1.x",
        pattern: /angular(?:\.min)?\.js.*?(\d+\.\d+\.\d+)/i,
        maxSafe: "2.0.0",
      },
      {
        name: "Lodash < 4.17.21",
        pattern: /lodash.*?(\d+\.\d+\.\d+)/i,
        maxSafe: "4.17.21",
      },
      {
        name: "Bootstrap < 5.3.0",
        pattern: /bootstrap(?:\.min)?\.(?:js|css).*?(\d+\.\d+\.\d+)/i,
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
      const match = body.match(lib.pattern);
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
    const match = body.match(/jquery[-.v]?(\d+)\.(\d+)\.?(\d*)/i);
    if (match) {
      const major = parseInt(match[1]);
      const minor = parseInt(match[2]);
      if (major < 3 || (major === 3 && minor < 5)) {
        return `Potentially outdated jQuery version (${major}.${minor}) - check for security updates.`;
      }
    }
    return null;
  },

  "outdated-angular": (_url, _headers, body) => {
    if (
      /angular(?:\.min)?\.js|ng-app/i.test(body) &&
      !/angular\/\d{2}\./i.test(body)
    ) {
      return "AngularJS (1.x) detected - end-of-life framework with known vulnerabilities.";
    }
    return null;
  },

  "prototype-js-outdated": (_url, _headers, body) => {
    if (/prototype\.js/i.test(body)) {
      return "Prototype.js detected - outdated library with known vulnerabilities.";
    }
    return null;
  },

  "mootools-outdated": (_url, _headers, body) => {
    if (/mootools/i.test(body)) {
      return "MooTools detected - outdated library with potential security issues.";
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
    if (body.includes("__NEXT_DATA__") || body.includes("/_next/"))
      found.push("Next.js");
    if (body.includes("__nuxt") || body.includes("/_nuxt/"))
      found.push("Nuxt.js");
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
      /<pre>.*<a href="[^"]*">.*<\/a>.*\d{4}-\d{2}-\d{2}/is,
    ];
    for (const p of indicators) {
      if (p.test(body))
        return "Directory listing indicators found in response.";
    }
    return null;
  },

  // ── Robots / sensitive endpoints in body ────────────────────────────────

  "robots-txt-exposure": (_url, _headers, body) => {
    if (/\/robots\.txt/i.test(body)) {
      return "robots.txt path found in body — confirm it doesn't leak sensitive paths.";
    }
    return null;
  },

  "sensitive-endpoints": (_url, _headers, body) => {
    const endpoints = [
      /\/api\/v\d+\/(?:users|admin|internal|debug|graphql|webhook)/gi,
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

  "admin-endpoint": (_url, _headers, body) => {
    if (
      /\/admin\/|\/administrator\/|\/management\/|\/dashboard\//gi.test(body)
    ) {
      return "Admin/management endpoints referenced in page source.";
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
    if (/['"\/]\.env(\.(local|production|development|test))?\b/.test(body)) {
      return ".env file reference found in page source.";
    }
    return null;
  },

  "backup-file-reference": (_url, _headers, body) => {
    if (/\.(bak|old|orig|save|swp|tmp|backup)\b/i.test(body)) {
      return "Backup file extension references (.bak, .old, .orig, etc.) detected.";
    }
    return null;
  },

  "phpinfo-exposed": (_url, _headers, body) => {
    if (/<title>phpinfo\(\)/i.test(body) || /phpinfo\.php/i.test(body)) {
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
      /Function\s*\(/i,
      /setTimeout\s*\(\s*['"]/i,
      /setInterval\s*\(\s*['"]/i,
    ];
    const found: string[] = [];
    for (const script of scripts) {
      if (script.includes("src=")) continue;
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
    const handlers =
      body.match(
        /\son\w+=["'][^"']*(?:location|document|window|eval|fetch|XMLHttpRequest|alert)[^"']*["']/gi,
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
    const sinks = [
      {
        name: "innerHTML with URL data",
        pattern:
          /\.innerHTML\s*=\s*(?:.*(?:location|document\.URL|document\.referrer|window\.name))/gi,
      },
      {
        name: "document.write with URL",
        pattern:
          /document\.write(?:ln)?\s*\(.*(?:location|document\.URL|document\.referrer)/gi,
      },
      {
        name: "eval with URL data",
        pattern:
          /eval\s*\(.*(?:location|document\.URL|document\.referrer|window\.name)/gi,
      },
      {
        name: "location assignment",
        pattern:
          /(?:location|location\.href)\s*=\s*(?:.*(?:location\.hash|location\.search|document\.referrer))/gi,
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

  "reverse-tabnabbing": (_url, _headers, body) => {
    const links = body.match(/<a[^>]*target=["']_blank["'][^>]*>/gi) || [];
    const unsafe = links.filter((l) => !/rel=["'][^"']*noopener/i.test(l));
    return unsafe.length > 2
      ? `Found ${unsafe.length} link(s) with target="_blank" missing rel="noopener".`
      : null;
  },

  "window-opener-abuse": (_url, _headers, body) => {
    const openerUsage = body.match(/window\.opener\./g) || [];
    return openerUsage.length > 0
      ? `Found ${openerUsage.length} window.opener reference(s).`
      : null;
  },

  "document-domain": (_url, _headers, body) => {
    const usage = body.match(/document\.domain\s*=/g) || [];
    return usage.length > 0
      ? `Found ${usage.length} document.domain assignment(s). This is deprecated and unsafe.`
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
    const sensitivePatterns = [
      /TODO/i,
      /FIXME/i,
      /HACK/i,
      /password/i,
      /secret/i,
      /admin/i,
      /internal/i,
      /debug/i,
      /temporary/i,
      /remove\s+(?:this|before)/i,
      /api[_\-]?key/i,
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

  "stack-trace-exposed": (_url, _headers, body) => {
    if (
      /at\s+[\w.]+\s+\([^)]+:\d+:\d+\)|Traceback \(most recent call last\)/i.test(
        body,
      )
    ) {
      return "Stack trace exposed in page output.";
    }
    return null;
  },

  "sql-error-in-page": (_url, _headers, body) => {
    const patterns = [
      /SQL syntax.*MySQL/i,
      /ORA-\d{5}/,
      /Microsoft SQL.*Driver/i,
      /PostgreSQL.*ERROR/i,
      /pg_query\(\)/i,
      /sqlite3?\.OperationalError/i,
      /SQLSTATE\[/,
    ];
    for (const p of patterns) {
      if (p.test(body))
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
    if (
      /Django Version:|Traceback.*most recent call/i.test(body) &&
      /settings\.py|INSTALLED_APPS/i.test(body)
    ) {
      return "Django debug page detected with framework details exposed.";
    }
    return null;
  },

  "laravel-debug-page": (_url, _headers, body) => {
    if (/Whoops.*Laravel|Illuminate\\.*Exception/i.test(body)) {
      return "Laravel debug page (Whoops) detected with framework details.";
    }
    return null;
  },

  "verbose-error-messages": (_url, _headers, body) => {
    const patterns = [
      /syntax error/i,
      /undefined variable/i,
      /null pointer/i,
      /access violation/i,
      /stack trace:/i,
      /at line \d+/i,
    ];
    for (const p of patterns) {
      if (p.test(body)) return "Verbose error message found in page output.";
    }
    return null;
  },

  // ── Email / phone / PII ──────────────────────────────────────────────────

  "email-exposure": (_url, _headers, body) => {
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    const emails = body.match(emailRegex) || [];
    const filtered = emails.filter((e) => {
      const lower = e.toLowerCase();
      const atIndex = lower.indexOf("@");
      if (atIndex === -1) return false;
      const domain = lower.substring(atIndex + 1);
      if (
        domain.endsWith(".png") ||
        domain.endsWith(".jpg") ||
        domain.endsWith(".svg") ||
        domain.endsWith(".gif") ||
        domain.endsWith(".webp")
      ) {
        return false;
      }
      const testDomains = [
        "example.com",
        "example.org",
        "test.com",
        "test.org",
        "schema.org",
        "w3.org",
        "sentry.io",
      ];
      if (testDomains.some((d) => domain === d || domain.endsWith("." + d))) {
        return false;
      }
      if (lower.includes("@2x") || lower.includes("@3x")) return false;
      return true;
    });
    const unique = [...new Set(filtered)];
    return unique.length > 0
      ? `Found ${unique.length} email address(es): ${unique.slice(0, 3).join(", ")}`
      : null;
  },

  "email-address-leak": (_url, _headers, body) => {
    const matches =
      body.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [];
    if (matches.length > 10) {
      return `Many email addresses (${matches.length}) found in page source - potential data leak.`;
    }
    return null;
  },

  "phone-number-leak": (_url, _headers, body) => {
    const matches =
      body.match(/(?:\+1|1)?[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g) || [];
    if (matches.length > 5) {
      return `Multiple phone numbers (${matches.length}) found in page source.`;
    }
    return null;
  },

  // ── JWT / tokens in HTML ────────────────────────────────────────────────

  "jwt-in-html": (_url, _headers, body) => {
    if (
      /eyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/.test(
        body,
      )
    ) {
      return "JWT token found embedded in HTML page source.";
    }
    return null;
  },

  "jwt-in-url": (_url, _headers, body) => {
    const jwtUrls =
      body.match(
        /(?:href|src|action|url)\s*=\s*["'][^"']*(?:\?|&)(?:token|jwt|access_token|auth)=eyJ[A-Za-z0-9_-]+/gi,
      ) || [];
    return jwtUrls.length > 0
      ? `Found ${jwtUrls.length} URL(s) containing JWT tokens.`
      : null;
  },

  "token-exposure": (_url, _headers, body) => {
    const sessions =
      body.match(
        /(?:PHPSESSID|JSESSIONID|ASP\.NET_SessionId)\s*=\s*[a-f0-9]{16,}/gi,
      ) || [];
    return sessions.length > 0
      ? `Session ID(s) exposed in source: ${sessions.length} found`
      : null;
  },

  // ── Storage APIs ─────────────────────────────────────────────────────────

  "storage-api-usage": (_url, _headers, body) => {
    const sensitiveKeys =
      /(?:localStorage|sessionStorage)\.(?:setItem|getItem)\s*\(\s*["'](?:token|jwt|auth|password|session|secret|api[_-]?key|credit[_-]?card)[^"']*["']/gi;
    const matches = body.match(sensitiveKeys) || [];
    return matches.length > 0
      ? `Found ${matches.length} sensitive storage API usage(s).`
      : null;
  },

  "local-storage-sensitive": (_url, _headers, body) => {
    const sensitive =
      body.match(
        /(?:localStorage|sessionStorage)\.setItem\s*\(\s*["'](?:token|auth|jwt|password|session|secret|api[_-]?key|credit[_-]?card|ssn)[^"']*["']/gi,
      ) || [];
    return sensitive.length > 0
      ? `Found ${sensitive.length} instance(s) of sensitive data in browser storage.`
      : null;
  },

  "document-cookie-access": (_url, _headers, body) => {
    const matches = body.match(/document\.cookie/g) || [];
    if (matches.length > 2) {
      return `${matches.length} document.cookie accesses - consider HttpOnly cookies.`;
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
    if (/<\/title><script|<img[^>]*onerror/gi.test(body)) {
      return "HTML injection patterns detected in page output.";
    }
    return null;
  },

  "reflected-input": (_url, _headers, body) => {
    const dangerousPatterns = [
      /jaVasCript:/gi,
      /<script[^>]*>[^<]*(?:document\.cookie|eval\(|alert\(|fetch\([^)]*document)/gi,
    ];
    for (const p of dangerousPatterns) {
      const match = body.match(p);
      if (match) {
        const idx = body.indexOf(match[0]);
        const before = body.slice(Math.max(0, idx - 300), idx).toLowerCase();
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

  "password-in-get": (_url, _headers, body) => {
    if (/[?&](?:password|passwd|pwd|pass)=/gi.test(body)) {
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
    if (/email.*(?:already exists|not found|is taken|invalid)/gi.test(body)) {
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
      /[?&](?:redirect|return|next|url|goto|dest|redir|returnTo|continue|forward|target)=[^&"'\s]+/gi,
      /window\.location\s*=\s*(?:decodeURIComponent|unescape)?\(?\s*(?:new\s+URLSearchParams|location\.(?:search|hash))/gi,
    ];
    const found: string[] = [];
    for (const p of patterns) {
      const matches = body.match(p) || [];
      found.push(...matches.slice(0, 3));
    }
    return found.length > 0
      ? `Found ${found.length} redirect-related pattern(s): ${found.slice(0, 2).join(", ")}`
      : null;
  },

  "open-redirect-params": (_url, _headers, body) => {
    const matches = body.match(
      /[?&](redirect|return|next|url|goto|destination|continue|redir|returnTo)\s*=\s*https?%3A/gi,
    );
    if (!matches) return null;
    return `Potential open redirect parameter(s) found: ${matches.length} occurrence(s).`;
  },

  // ── Server-info (config headers + version disclosure) ──────────────────

  "server-info": (_url, headers) => {
    const hdrs: string[] = [];
    const keys = ["server", "x-powered-by", "x-aspnet-version", "via"];
    for (const k of keys) {
      const v = headers.get(k);
      if (v) hdrs.push(`${k}: ${v}`);
    }
    return hdrs.length > 0 ? hdrs.join("; ") : null;
  },

  "version-disclosure": (_url, headers) => {
    for (const [k, v] of headers.entries()) {
      if (/\d+\.\d+/.test(v)) {
        return `${k}: ${v}`;
      }
    }
    return null;
  },

  // ── Config check missing (placeholder for config docs) ─────────────────

  "config-file-leaked": (_url, _headers, body) => {
    const patterns = [
      /config\.ya?ml/i,
      /config\.json/i,
      /\.env(\.|$)/i,
      /docker-compose/i,
    ];
    for (const p of patterns) {
      if (p.test(body)) return "Configuration file reference found in body.";
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
};
