/**
 * Code / SAST-style detectors.
 *
 * Pure regex-based detection of dangerous code patterns in inline
 * JavaScript, server-rendered HTML, and embedded source. Real SAST
 * requires AST parsing; this is a fast pre-filter that catches the
 * common sinks. Lives in its own category so the docs page can
 * present it as "code testing" instead of lumping it into headers.
 */

import { type EvidenceFn as DetectFn } from "../_helpers";

export const detectors: Record<string, DetectFn> = {
  // ── DOM XSS sinks ─────────────────────────────────────────────────────────

  "innerhtml-xss-sink": (_url, _headers, body) => {
    const matches = body.match(/\.innerHTML\s*=(?!\s*["'])/g) || [];
    if (matches.length < 2) return null;
    return `Found ${matches.length} innerHTML assignments that may be XSS sinks.`;
  },

  "outerhtml-xss-sink": (_url, _headers, body) => {
    const matches = body.match(/\.outerHTML\s*=/g) || [];
    if (matches.length < 1) return null;
    return `Found ${matches.length} outerHTML assignment(s) - potential XSS sink.`;
  },

  "document-write-sink": (_url, _headers, body) => {
    const matches = body.match(/document\.write(?:ln)?\s*\(/g) || [];
    if (matches.length < 1) return null;
    return `Found ${matches.length} document.write() call(s) - DOM XSS sink.`;
  },

  "insertadjacenthtml-sink": (_url, _headers, body) => {
    if (/\.insertAdjacentHTML\s*\(/g.test(body)) {
      return "insertAdjacentHTML() found - potential DOM XSS sink.";
    }
    return null;
  },

  "unsafe-setattribute": (_url, _headers, body) => {
    if (
      /\.setAttribute\s*\(\s*["'](?:on\w+|href|src|action)["']/gi.test(body)
    ) {
      return "setAttribute() used with event handlers or URL attributes - XSS risk.";
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

  // ── Eval / function / setTimeout strings ────────────────────────────────

  "eval-in-scripts": (_url, _headers, body) => {
    const scripts = body.match(/<script[^>]*>[\s\S]*?<\/script[^>]*>/gi) || [];
    for (const s of scripts) {
      if (/\beval\s*\(/.test(s) && !s.includes("JSON.parse")) {
        return "eval() usage detected in inline scripts.";
      }
    }
    return null;
  },

  "eval-usage": (_url, _headers, body) => {
    const matches = body.match(/\beval\s*\(/g) || [];
    if (matches.length > 0) {
      return `${matches.length} eval() call(s) found - code execution risk.`;
    }
    return null;
  },

  "function-constructor": (_url, _headers, body) => {
    if (/new\s+Function\s*\(/g.test(body)) {
      return "Function constructor used - similar risks to eval().";
    }
    return null;
  },

  "settimeout-string": (_url, _headers, body) => {
    if (
      /setTimeout\s*\(\s*["']/g.test(body) ||
      /setInterval\s*\(\s*["']/g.test(body)
    ) {
      return "setTimeout/setInterval with string argument - implicit eval().";
    }
    return null;
  },

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

  // ── postMessage ──────────────────────────────────────────────────────────

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

  // ── Storage / cookies ────────────────────────────────────────────────────

  "local-storage-sensitive": (_url, _headers, body) => {
    const sensitive =
      body.match(
        /(?:localStorage|sessionStorage)\.setItem\s*\(\s*["'](?:token|auth|jwt|password|session|secret|api[_-]?key|credit[_-]?card|ssn)[^"']*["']/gi,
      ) || [];
    return sensitive.length > 0
      ? `Found ${sensitive.length} instance(s) of sensitive data in browser storage.`
      : null;
  },

  "storage-api-usage": (_url, _headers, body) => {
    const sensitiveKeys =
      /(?:localStorage|sessionStorage)\.(?:setItem|getItem)\s*\(\s*["'](?:token|jwt|auth|password|session|secret|api[_-]?key|credit[_-]?card)[^"']*["']/gi;
    const matches = body.match(sensitiveKeys) || [];
    return matches.length > 0
      ? `Found ${matches.length} sensitive storage API usage(s).`
      : null;
  },

  "document-cookie-access": (_url, _headers, body) => {
    const matches = body.match(/document\.cookie/g) || [];
    if (matches.length > 2) {
      return `${matches.length} document.cookie accesses - consider HttpOnly cookies.`;
    }
    return null;
  },

  // ── Prototype / misc ─────────────────────────────────────────────────────

  "prototype-pollution": (_url, _headers, body) => {
    const patterns = [
      /__proto__/g,
      /Object\.assign\s*\(\s*{}\s*,\s*(?:req|request|params|query|body)\./gi,
      /constructor\s*\[\s*["']prototype["']\s*\]/gi,
    ];
    const found: string[] = [];
    for (const p of patterns) {
      const matches = body.match(p);
      if (matches) found.push(`${matches[0].slice(0, 25)} (${matches.length})`);
    }
    return found.length > 0
      ? `Prototype pollution patterns: ${found.join(", ")}`
      : null;
  },

  "insecure-crypto": (_url, _headers, body) => {
    const patterns = [
      { name: "MD5", pattern: /(?:CryptoJS\.)?MD5\s*\(/gi },
      { name: "SHA-1", pattern: /(?:CryptoJS\.)?SHA1?\s*\(/gi },
      {
        name: "Math.random for crypto",
        pattern:
          /Math\.random\s*\(\s*\).*(?:token|password|key|secret|nonce|salt)/gi,
      },
    ];
    const found: string[] = [];
    for (const { name, pattern } of patterns) {
      if (pattern.test(body)) found.push(name);
    }
    return found.length > 0
      ? `Insecure crypto usage: ${found.join(", ")}`
      : null;
  },

  // ── SQL / command / SSRF / XXE / path / SSTI / LDAP ──────────────────────

  "sql-injection-patterns": (_url, _headers, body) => {
    const patterns = [
      /(?:SELECT|INSERT|UPDATE|DELETE)\s+.*(?:FROM|INTO|SET)\s+\w+.*(?:WHERE|VALUES)/gi,
      /(?:UNION\s+ALL\s+SELECT|OR\s+1\s*=\s*1|AND\s+1\s*=\s*1|'\s*OR\s*')/gi,
    ];
    const found: string[] = [];
    for (const p of patterns) {
      const matches = body.match(p) || [];
      const inScripts = matches.filter((m) => {
        const idx = body.indexOf(m);
        const before = body.slice(Math.max(0, idx - 200), idx);
        return /<script/i.test(before) && !/<code|<pre|```/i.test(before);
      });
      if (inScripts.length > 0) found.push(...inScripts.slice(0, 2));
    }
    return found.length > 0
      ? `SQL patterns in inline scripts: ${found
          .slice(0, 2)
          .map((f) => f.slice(0, 50))
          .join("; ")}`
      : null;
  },

  "command-injection": (_url, _headers, body) => {
    const patterns = [
      /(?:exec|spawn|execSync|system|popen)\s*\([^)]*(?:\$|`|\+\s*(?:req|request|params|query|body)\.)/gi,
    ];
    const found: string[] = [];
    for (const p of patterns) {
      if (p.test(body)) found.push(p.source.slice(0, 30));
    }
    return found.length > 0 ? `Command injection patterns detected.` : null;
  },

  "command-injection-indicators": (_url, _headers, body) => {
    if (/[?&](?:cmd|exec|command|run|shell)=/gi.test(body)) {
      return "Command-related parameter names found - potential command injection vector.";
    }
    return null;
  },

  "ssrf-vulnerability": (_url, _headers, body) => {
    const patterns = [
      /fetch\s*\(\s*(?:req|request|params|query|body)\./gi,
      /axios\s*\.\s*(?:get|post)\s*\(\s*(?:req|request|params|query)\./gi,
      /http\.(?:get|request)\s*\(\s*(?:req|request|params|query)\./gi,
    ];
    const found: string[] = [];
    for (const p of patterns) {
      if (p.test(body)) found.push("User input in URL fetch");
    }
    return found.length > 0 ? `SSRF risk: ${found[0]}` : null;
  },

  "ssrf-indicators": (_url, _headers, body) => {
    const patterns = [
      /url=http/gi,
      /[?&](?:image|img|src|file|path|uri)=https?%3A/gi,
      /fetch\s*\(\s*(?:req|request|params|query)\./gi,
    ];
    for (const p of patterns) {
      if (p.test(body))
        return "Potential SSRF indicators found - user-controlled URL parameters.";
    }
    return null;
  },

  "path-traversal": (_url, _headers, body) => {
    const patterns = [
      /\.\.[\/\\]/g,
      /(?:readFile|readFileSync|createReadStream)\s*\([^)]*(?:\+|`\$\{).*(?:req|request|params|query)\./gi,
    ];
    const contextual = body.match(patterns[1]) || [];
    return contextual.length > 0
      ? `Path traversal risk: user input in file read operations.`
      : null;
  },

  "path-traversal-indicators": (_url, _headers, body) => {
    if (
      /[?&](?:file|path|dir|folder|include)=[^&]*(?:\.\.\/|\.\.%2F)/gi.test(
        body,
      )
    ) {
      return "Potential path traversal pattern in URL parameters.";
    }
    return null;
  },

  "xxe-vulnerability": (_url, _headers, body) => {
    const xxePattern = /<!DOCTYPE[^>]*\[[\s\S]*?<!ENTITY/i;
    if (xxePattern.test(body)) {
      const match = body.match(xxePattern);
      if (match) {
        const idx = body.indexOf(match[0]);
        const before = body.slice(Math.max(0, idx - 200), idx).toLowerCase();
        if (/<code|<pre|```/i.test(before)) return null;
        return "XXE risk: DOCTYPE with ENTITY declaration found";
      }
    }
    return null;
  },

  "xml-external-entity": (_url, _headers, body) => {
    const xxePattern =
      /<!DOCTYPE[^>]*\[[\s\S]*?<!ENTITY[^>]*(?:SYSTEM|PUBLIC)/i;
    if (xxePattern.test(body)) {
      const match = body.match(xxePattern);
      if (match) {
        const idx = body.indexOf(match[0]);
        const before = body.slice(Math.max(0, idx - 200), idx).toLowerCase();
        if (/<code|<pre|```|example|documentation/i.test(before)) return null;
        return "XML external entity declaration found - potential XXE vulnerability.";
      }
    }
    return null;
  },

  "insecure-deserialization": (_url, _headers, body) => {
    const patterns = [
      /JSON\.parse\s*\(\s*(?:req|request|params|query|body)\./gi,
      /unserialize\s*\(/gi,
      /pickle\.loads/gi,
      /yaml\.(?:load|safe_load)\s*\(\s*(?:req|request)/gi,
    ];
    const found: string[] = [];
    for (const p of patterns) {
      if (p.test(body)) found.push("Deserialization of user input");
    }
    return found.length > 0 ? `Insecure deserialization risk detected.` : null;
  },

  "insecure-auth": (_url, _headers, body) => {
    const patterns = [
      { name: "Basic auth over HTTP", pattern: /Authorization:\s*Basic/gi },
      {
        name: "Password in URL",
        pattern: /(?:password|passwd|pwd)\s*=\s*[^&\s]{3,}/gi,
      },
      {
        name: "Hardcoded credentials",
        pattern:
          /(?:username|user|login)\s*[:=]\s*["'][^"']+["']\s*[,;\n].*(?:password|passwd|pwd)\s*[:=]\s*["'][^"']+["']/gi,
      },
    ];
    const found: string[] = [];
    for (const { name, pattern } of patterns) {
      if (pattern.test(body)) found.push(name);
    }
    return found.length > 0
      ? `Insecure auth patterns: ${found.join(", ")}`
      : null;
  },

  "ssti-indicators": (_url, _headers, body) => {
    if (/\{\{\s*\d+\s*\*\s*\d+\s*\}\}|\$\{.*?\}|<%.*?%>/g.test(body)) {
      return "Template syntax detected in output - potential SSTI vulnerability.";
    }
    return null;
  },

  "ldap-injection-indicators": (_url, _headers, body) => {
    if (/[?&](?:user|uid|cn|dn|filter)=[^&]*[()&|*]/gi.test(body)) {
      return "LDAP filter characters in URL parameters - potential LDAP injection.";
    }
    return null;
  },

  // ── Auth enumeration / hardcoded credentials ────────────────────────────

  "hardcoded-credentials": (_url, _headers, body) => {
    const patterns = [
      /(?:admin|root)\s*[:=]\s*["']([^"']+)["']/gi,
      /(?:password|passwd|pwd)\s*[:=]\s*["']([^"']+)["']/gi,
    ];
    const hits: string[] = [];
    for (const p of patterns) {
      const m = body.match(p);
      if (m) hits.push(m[0].slice(0, 60));
    }
    return hits.length > 0
      ? `Hardcoded credentials pattern detected: ${hits.slice(0, 3).join("; ")}`
      : null;
  },

  "default-credentials": (_url, _headers, body) => {
    const defaults = [
      "admin/admin",
      "root/root",
      "admin/password",
      "guest/guest",
    ];
    for (const d of defaults) {
      if (body.includes(d)) {
        return `Default credentials reference: ${d}`;
      }
    }
    return null;
  },

  // ── SRI / external assets (sast-ish for <script src>) ───────────────────

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

  // ── Window opener abuse / reverse tabnabbing ────────────────────────────

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

  // ── Open redirect / SSRF patterns ────────────────────────────────────────

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

  // ── GraphQL query patterns ───────────────────────────────────────────────

  "graphql-introspection": (_url, _headers, body) => {
    const indicators = [
      /__schema/i,
      /introspectionQuery/i,
      /__type/i,
      /graphiql/i,
      /playground.*graphql/i,
      /altair/i,
    ];
    const found: string[] = [];
    for (const p of indicators) {
      if (p.test(body)) found.push(p.source.replace(/[\\]/g, ""));
    }
    return found.length > 0
      ? `GraphQL introspection indicators: ${found.join(", ")}`
      : null;
  },

  // ── Source-map / debug paths in code ────────────────────────────────────

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

  // ── Hardcoded secrets (SAST) ────────────────────────────────────────────

  "hardcoded-secrets": (_url, _headers, body) => {
    const lowerBody = body.toLowerCase();
    const isDocPage =
      lowerBody.includes("documentation") &&
      lowerBody.includes("example") &&
      lowerBody.includes("api");

    const patterns = [
      { name: "AWS Access Key", pattern: /AKIA[0-9A-Z]{16}/g },
      {
        name: "Azure Storage Key",
        pattern:
          /DefaultEndpointsProtocol=https;AccountName=[^;]+;AccountKey=[A-Za-z0-9+/=]{86,88}/g,
      },
      {
        name: "GCP Service Account",
        pattern: /"type"\s*:\s*"service_account"/g,
      },
      { name: "Google API Key", pattern: /AIzaSy[0-9A-Za-z_-]{33}/g },
      {
        name: "Firebase Key",
        pattern: /AAAA[A-Za-z0-9_-]{7}:[A-Za-z0-9_-]{140}/g,
      },
      { name: "Stripe Secret Key", pattern: /sk_live_[0-9a-zA-Z]{24,}/g },
      { name: "Stripe Restricted Key", pattern: /rk_live_[0-9a-zA-Z]{24,}/g },
      { name: "Stripe Webhook Secret", pattern: /whsec_[0-9a-zA-Z]{24,}/g },
      { name: "Square Access Token", pattern: /sq0atp-[0-9A-Za-z_-]{22}/g },
      { name: "Square OAuth Secret", pattern: /sq0csp-[0-9A-Za-z_-]{43}/g },
      { name: "GitHub Token", pattern: /gh[pousr]_[0-9A-Za-z]{36,}/g },
      { name: "GitHub OAuth", pattern: /gho_[0-9A-Za-z]{36,}/g },
      { name: "GitLab Token", pattern: /glpat-[0-9A-Za-z_-]{20,}/g },
      { name: "Bitbucket Token", pattern: /ATBB[0-9A-Za-z]{32,}/g },
      {
        name: "Slack Token",
        pattern: /xox[bpras]-[0-9]{10,}-[0-9a-zA-Z-]+/g,
      },
      {
        name: "Slack Webhook",
        pattern:
          /hooks\.slack\.com\/services\/T[0-9A-Z]{8,}\/B[0-9A-Z]{8,}\/[0-9A-Za-z]{24}/g,
      },
      {
        name: "Discord Bot Token",
        pattern: /[MN][A-Za-z\d]{23,}\.[\w-]{6}\.[\w-]{38,}/g,
      },
      {
        name: "Discord Webhook",
        pattern:
          /discord(?:app)?\.com\/api\/webhooks\/\d{17,20}\/[\w-]{60,68}/g,
      },
      { name: "Twilio Account SID", pattern: /AC[0-9a-fA-F]{32}/g },
      {
        name: "SendGrid Key",
        pattern: /SG\.[0-9A-Za-z_-]{22}\.[0-9A-Za-z_-]{43}/g,
      },
      { name: "Mailgun Key", pattern: /key-[0-9a-f]{32}/g },
      {
        name: "MongoDB URI",
        pattern: /mongodb(?:\+srv)?:\/\/[^:]+:[^\s@"'<>]+@[^\s"'<>]{5,}/g,
      },
      {
        name: "PostgreSQL URI",
        pattern: /postgres(?:ql)?:\/\/[^:]+:[^\s@"'<>]+@[^\s"'<>]{5,}/g,
      },
      {
        name: "MySQL URI",
        pattern: /mysql:\/\/[^:]+:[^\s@"'<>]+@[^\s"'<>]{5,}/g,
      },
      {
        name: "Redis URI",
        pattern: /rediss?:\/\/[^:]+:[^\s@"'<>]+@[^\s"'<>]{5,}/g,
      },
      {
        name: "Firebase URL",
        pattern: /https:\/\/[a-z0-9-]+\.firebaseio\.com/g,
      },
      { name: "OAuth Token", pattern: /ya29\.[0-9A-Za-z_-]{68,}/g },
      {
        name: "OpenAI Key",
        pattern: /sk-[A-Za-z0-9]{20,}T3BlbkFJ[A-Za-z0-9]{20,}/g,
      },
      { name: "OpenAI Project Key", pattern: /sk-proj-[A-Za-z0-9_-]{40,}/g },
      { name: "Anthropic Key", pattern: /sk-ant-[A-Za-z0-9_-]{40,}/g },
      { name: "HuggingFace Token", pattern: /hf_[A-Za-z0-9]{34,}/g },
      { name: "Replicate Token", pattern: /r8_[A-Za-z0-9]{40}/g },
      { name: "New Relic Key", pattern: /NRAK-[A-Z0-9]{27}/g },
      {
        name: "Sentry DSN",
        pattern: /https:\/\/[0-9a-f]{32}@[a-z0-9.]+\.sentry\.io\/\d+/g,
      },
      {
        name: "Mapbox Token",
        pattern: /pk\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
      },
      { name: "Facebook Token", pattern: /EAA[0-9A-Za-z]{100,}/g },
      { name: "RSA Private Key", pattern: /-----BEGIN RSA PRIVATE KEY-----/g },
      { name: "EC Private Key", pattern: /-----BEGIN EC PRIVATE KEY-----/g },
      {
        name: "PGP Private Key",
        pattern: /-----BEGIN PGP PRIVATE KEY BLOCK-----/g,
      },
      {
        name: "SSH Private Key",
        pattern: /-----BEGIN (?:OPENSSH |DSA )?PRIVATE KEY-----/g,
      },
      {
        name: "Generic Secret",
        pattern:
          /(?:api_secret|secret_key|private_key|client_secret|app_secret)\s*[:=]\s*["'][a-zA-Z0-9/+=_-]{20,}["']/gi,
      },
      {
        name: "Connection String",
        pattern:
          /(?:connection_string|database_url|dsn)\s*[:=]\s*["'][^"']{20,}["']/gi,
      },
    ];
    if (isDocPage) return null;

    const found: string[] = [];
    for (const { name, pattern } of patterns) {
      const matches = body.match(pattern);
      if (matches) {
        const unique = [...new Set(matches)].filter((m) => {
          const lower = m.toLowerCase();
          if (
            lower.includes("example") ||
            lower.includes("your_") ||
            lower.includes("xxxx") ||
            lower.includes("0000")
          )
            return false;
          if (
            lower.includes("placeholder") ||
            lower.includes("test_") ||
            lower.includes("dummy")
          )
            return false;
          if (/localhost|127\.0\.0\.1/.test(m)) return false;
          return true;
        });
        if (unique.length === 0) continue;
        for (const match of unique.slice(0, 3)) {
          const len = match.length;
          const redacted =
            len <= 12
              ? match.slice(0, 4) + "****"
              : match.slice(0, 8) + "****" + match.slice(-4);
          found.push(`${name}: ${redacted}`);
        }
        if (unique.length > 3) {
          found.push(
            `  ...and ${unique.length - 3} more ${name} occurrence(s)`,
          );
        }
      }
    }
    return found.length > 0
      ? `Potential secrets detected:\n${found.join("\n")}`
      : null;
  },

  // ── Geo / clipboard / media APIs ────────────────────────────────────────

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
};
