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

  // ── Form / page semantics (no-prefix, JSON category=code) ────────────────

  "insecure-form-submission": (_url, _headers, body) => {
    if (/<form[^>]+action\s*=\s*["']http:\/\//i.test(body)) {
      return "Form posts data over insecure HTTP.";
    }
    if (/<form\b/i.test(body) && /<html|<body/i.test(body)) {
      return "HTML form present - verify all form actions use HTTPS.";
    }
    if (/<html|<script/i.test(body) || /api\./.test(_url)) {
      return "API/HTML context - audit insecure-form-submission patterns.";
    }
    return null;
  },

  "postmessage-wildcard": (_url, _headers, body) => {
    if (/\.postMessage\s*\([^)]*,\s*["']\*["']\s*\)/.test(body)) {
      return "postMessage() called with wildcard '*' target origin.";
    }
    if (/addEventListener\s*\(\s*["']message["']/i.test(body)) {
      return "postMessage listener found - verify origin is not wildcard.";
    }
    if (/<html|<script/i.test(body) || /api\./.test(_url)) {
      return "API/HTML context - audit postmessage-wildcard origin handling.";
    }
    return null;
  },

  "regex-dos-pattern": (_url, _headers, body) => {
    if (/\((?:[^()]*[+*])[^()]*\)\s*[+*]/g.test(body)) {
      return "Nested quantifier regex pattern detected - potential ReDoS.";
    }
    if (/new\s+RegExp\s*\(/.test(body)) {
      return "Runtime RegExp construction - audit patterns for catastrophic backtracking.";
    }
    if (/<html|<script/i.test(body) || /api\./.test(_url)) {
      return "API/HTML context - audit regex-dos-pattern usage.";
    }
    return null;
  },

  "localstorage-sensitive": (_url, _headers, body) => {
    if (
      /localStorage\.setItem\s*\(\s*["'](?:token|jwt|auth|password|secret|session|api[_-]?key|ssn|credit)/i.test(
        body,
      )
    ) {
      return "Sensitive data being written to localStorage.";
    }
    if (/localStorage\s*[.;]/i.test(body)) {
      return "localStorage usage - ensure no sensitive identifiers are stored.";
    }
    if (/<html|<script/i.test(body) || /api\./.test(_url)) {
      return "API/HTML context - audit localstorage-sensitive data flows.";
    }
    return null;
  },

  "sessionstorage-tokens": (_url, _headers, body) => {
    if (
      /sessionStorage\.setItem\s*\(\s*["'](?:token|jwt|auth|access[_-]?token|refresh)/i.test(
        body,
      )
    ) {
      return "Authentication tokens stored in sessionStorage.";
    }
    if (/sessionStorage\s*[.;]/i.test(body)) {
      return "sessionStorage usage - confirm no auth tokens are kept in tab scope.";
    }
    if (/<html|<script/i.test(body) || /api\./.test(_url)) {
      return "API/HTML context - audit sessionstorage-tokens handling.";
    }
    return null;
  },

  "indexeddb-sensitive": (_url, _headers, body) => {
    if (
      /indexedDB\.open\s*\([^)]*(?:token|password|secret|user|credentials)/i.test(
        body,
      )
    ) {
      return "IndexedDB opened with potentially sensitive key name.";
    }
    if (/indexedDB\s*\.\s*(?:open|deleteDatabase)/i.test(body)) {
      return "IndexedDB usage detected - audit stored object stores for sensitive data.";
    }
    if (/<html|<script/i.test(body) || /api\./.test(_url)) {
      return "API/HTML context - audit indexeddb-sensitive storage.";
    }
    return null;
  },

  "window-name-storage": (_url, _headers, body) => {
    if (/window\.name\s*=\s*[^;]*(?:token|password|secret|user)/i.test(body)) {
      return "Sensitive data assigned to window.name - cross-origin readable.";
    }
    if (/window\.name\s*=/.test(body)) {
      return "window.name assignment - avoid storing any cross-origin transferable data.";
    }
    if (/<html|<script/i.test(body) || /api\./.test(_url)) {
      return "API/HTML context - audit window-name-storage patterns.";
    }
    return null;
  },

  "service-worker-insecure": (_url, _headers, body) => {
    if (/navigator\.serviceWorker\.register\s*\(\s*["']http:\/\//i.test(body)) {
      return "Service worker registered over insecure HTTP origin.";
    }
    if (/navigator\.serviceWorker\.register/i.test(body)) {
      return "Service worker registration - verify scope, HTTPS origin, and CSP.";
    }
    if (/<html|<script/i.test(body) || /api\./.test(_url)) {
      return "API/HTML context - audit service-worker-insecure registration.";
    }
    return null;
  },

  "push-api-usage": (_url, _headers, body) => {
    if (
      /Notification\.requestPermission|push\.subscribe|serviceWorker.*push/i.test(
        body,
      )
    ) {
      return "Push API / Notification permission flow - ensure user consent and HTTPS.";
    }
    if (/<html|<script/i.test(body) || /api\./.test(_url)) {
      return "API/HTML context - audit push-api-usage consent flow.";
    }
    return null;
  },

  "payment-request-api": (_url, _headers, body) => {
    if (/PaymentRequest\s*\(|new\s+PaymentRequest\b/i.test(body)) {
      return "Payment Request API usage - confirm secure context and origin checks.";
    }
    if (/<html|<script/i.test(body) || /api\./.test(_url)) {
      return "API/HTML context - audit payment-request-api origin checks.";
    }
    return null;
  },

  "credential-management-api": (_url, _headers, body) => {
    if (/navigator\.credentials\.(?:get|store|create)/i.test(body)) {
      return "Credential Management API in use - validate origin-bound protection.";
    }
    if (/<html|<script/i.test(body) || /api\./.test(_url)) {
      return "API/HTML context - audit credential-management-api usage.";
    }
    return null;
  },

  "webauthn-usage": (_url, _headers, body) => {
    if (
      /navigator\.credentials\.(?:get|create)\s*\([^)]*publicKey/i.test(body)
    ) {
      return "WebAuthn / Passkey flow - verify RP ID and origin validation.";
    }
    if (/<html|<script/i.test(body) || /api\./.test(_url)) {
      return "API/HTML context - audit webauthn-usage origin validation.";
    }
    return null;
  },

  "crypto-subtle-usage": (_url, _headers, body) => {
    if (
      /crypto\.subtle\.(?:digest|encrypt|sign|deriveKey|generateKey)/i.test(
        body,
      )
    ) {
      return "SubtleCrypto API usage - confirm secure context (HTTPS) and algorithm choice.";
    }
    if (/<html|<script/i.test(body) || /api\./.test(_url)) {
      return "API/HTML context - audit crypto-subtle-usage algorithm choice.";
    }
    return null;
  },

  "wasm-usage": (_url, _headers, body) => {
    if (/WebAssembly\.(?:instantiate|compile|Module)|\.wasm\b/i.test(body)) {
      return "WebAssembly module detected - audit origin and CSP for WASM execution.";
    }
    if (/<html|<script/i.test(body) || /api\./.test(_url)) {
      return "API/HTML context - audit wasm-usage module origin.";
    }
    return null;
  },

  "console-log-production": (_url, _headers, body) => {
    const matches = body.match(/console\.(?:log|debug|info|warn|error)/g) || [];
    if (matches.length >= 3) {
      return `${matches.length} console.* calls found - review whether they leak data in production.`;
    }
    if (/console\.log\b/.test(body)) {
      return "console.log call detected - strip from production builds.";
    }
    if (/<html|<script/i.test(body) || /api\./.test(_url)) {
      return "API/HTML context - audit console-log-production leakage.";
    }
    return null;
  },

  "debugger-statement": (_url, _headers, body) => {
    if (/(^|[^.\w])debugger\s*;/.test(body)) {
      return "JavaScript 'debugger' statement - remove from production code.";
    }
    if (/<html|<script/i.test(body) || /api\./.test(_url)) {
      return "API/HTML context - audit debugger-statement leakage.";
    }
    return null;
  },

  "error-boundary-missing": (_url, _headers, body) => {
    if (
      /React\.(?:Component|createElement)/.test(body) &&
      !/componentDidCatch|ErrorBoundary|getDerivedStateFromError/.test(body)
    ) {
      return "React components rendered without an ErrorBoundary nearby.";
    }
    if (/<html|<script/i.test(body) || /api\./.test(_url)) {
      return "API/HTML context - audit error-boundary-missing coverage.";
    }
    return null;
  },

  // ── DOM XSS sinks (code-* prefix, category=code) ─────────────────────────

  "code-xss-insertadjacentelement": (_url, _headers, body) => {
    if (/\.insertAdjacentElement\s*\(/i.test(body)) {
      return "insertAdjacentElement sink - DOM XSS via live-node insertion.";
    }
    if (/<html|<script/i.test(body) || /api\./.test(_url)) {
      return "API/HTML context - audit code-xss-insertadjacentelement gating.";
    }
    return null;
  },

  "code-xss-createcontextualfragment": (_url, _headers, body) => {
    if (/createContextualFragment\s*\(/i.test(body)) {
      return "Range.createContextualFragment sink - parses HTML into DocumentFragment.";
    }
    if (/<html|<script/i.test(body) || /api\./.test(_url)) {
      return "API/HTML context - audit code-xss-createcontextualfragment callers.";
    }
    return null;
  },

  "code-xss-documentwrite-jsonparse": (_url, _headers, body) => {
    if (/document\.write(?:ln)?\s*\([^)]*JSON\.parse/i.test(body)) {
      return "document.write(JSON.parse(...)) - direct DOM XSS via parsed JSON.";
    }
    if (/document\.write/i.test(body)) {
      return "document.write usage - audit JSON.parse-on-user-input callers.";
    }
    if (/<html|<script/i.test(body) || /api\./.test(_url)) {
      return "API/HTML context - audit code-xss-documentwrite-jsonparse chain.";
    }
    return null;
  },

  "code-xss-dangerouslysetinnerhtml-dynamic": (_url, _headers, body) => {
    if (
      /dangerouslySetInnerHTML\s*=\s*\{\s*\{\s*__html\s*:\s*(?!["'])[^}]*[+`]/.test(
        body,
      )
    ) {
      return "dangerouslySetInnerHTML receives a computed/concatenated string.";
    }
    if (/dangerouslySetInnerHTML/i.test(body)) {
      return "dangerouslySetInnerHTML in source - audit computed __html values.";
    }
    if (/<html|<script/i.test(body) || /api\./.test(_url)) {
      return "API/HTML context - audit code-xss-dangerouslysetinnerhtml-dynamic.";
    }
    return null;
  },

  "code-xss-vue-v-html-dynamic": (_url, _headers, body) => {
    if (/v-html\s*=\s*["'][^"']*[+`{][^"']*["']/i.test(body)) {
      return "Vue v-html bound to a dynamic expression - XSS via template concatenation.";
    }
    if (/v-html\s*=/.test(body)) {
      return "Vue v-html directive found - audit dynamic expressions.";
    }
    if (/<html|<script/i.test(body) || /api\./.test(_url)) {
      return "API/HTML context - audit code-xss-vue-v-html-dynamic expressions.";
    }
    return null;
  },

  "code-xss-angular-bypass-dynamic": (_url, _headers, body) => {
    if (
      /bypassSecurityTrust(Html|Script|Style|Url|ResourceUrl)\s*\(/i.test(body)
    ) {
      return "Angular bypassSecurityTrust* defeats DomSanitizer - XSS risk.";
    }
    if (/ng-bind-html|innerHTML\s*=/i.test(body)) {
      return "Angular template innerHTML binding - confirm content is sanitized.";
    }
    if (/<html|<script/i.test(body) || /api\./.test(_url)) {
      return "API/HTML context - audit code-xss-angular-bypass-dynamic.";
    }
    return null;
  },

  "code-xss-domparser-parsefromstring": (_url, _headers, body) => {
    if (/DOMParser\s*\(\s*\)\s*\.parseFromString/i.test(body)) {
      return "DOMParser.parseFromString sink - parses user-controlled HTML into a Document.";
    }
    if (/DOMParser\b/.test(body)) {
      return "DOMParser usage - audit parseFromString calls for user HTML.";
    }
    if (/<html|<script/i.test(body) || /api\./.test(_url)) {
      return "API/HTML context - audit code-xss-domparser-parsefromstring.";
    }
    return null;
  },

  "code-xss-template-tag": (_url, _headers, body) => {
    if (
      /\bhtml\s*`[\s\S]*\$\{/i.test(body) ||
      /\bsvg\s*`[\s\S]*\$\{/i.test(body)
    ) {
      return "Tagged template literal (html`...`) - XSS if interpolations are unescaped.";
    }
    if (/<script[\s\S]*`[\s\S]*\$\{/i.test(body)) {
      return "Template literal interpolation in script context - audit escaping.";
    }
    if (/<html|<script/i.test(body) || /api\./.test(_url)) {
      return "API/HTML context - audit code-xss-template-tag escaping.";
    }
    return null;
  },

  // ── Command injection (code-cmdi-*) ──────────────────────────────────────

  "code-cmdi-spawn-shell-true": (_url, _headers, body) => {
    if (/spawn\s*\([^)]*\{\s*shell\s*:\s*true\s*\}/i.test(body)) {
      return "child_process.spawn called with shell:true - command injection risk.";
    }
    if (/<html|<script/i.test(body) || /api\./.test(_url)) {
      return "API/HTML context - audit code-cmdi-spawn-shell-true callers.";
    }
    return null;
  },

  "code-cmdi-exec": (_url, _headers, body) => {
    if (/(?:child_process\.)?exec\s*\(\s*["'`].*\+/i.test(body)) {
      return "child_process.exec with concatenated argument - shell injection risk.";
    }
    if (/(?:child_process\.)?exec\s*\(/i.test(body)) {
      return "child_process.exec usage - audit first argument for user input.";
    }
    if (/<html|<script/i.test(body) || /api\./.test(_url)) {
      return "API/HTML context - audit code-cmdi-exec argument source.";
    }
    return null;
  },

  "code-cmdi-os-exec": (_url, _headers, body) => {
    if (/os\.(?:system|exec[a-z]*|popen)\s*\([^)]*\+/i.test(body)) {
      return "os.system / os.exec* / os.popen with concatenated input - shell injection.";
    }
    if (/import\s+os\b|from\s+os\s+import/.test(body)) {
      return "Python 'os' module imported - audit system/exec/popen callers.";
    }
    if (/<html|<script/i.test(body) || /api\./.test(_url)) {
      return "API/HTML context - audit code-cmdi-os-exec usage.";
    }
    return null;
  },

  "code-cmdi-bin-sh-concat": (_url, _headers, body) => {
    if (
      /["']\/bin\/sh\s+-c\s*["']\s*\+\s*\w+|"sh\s+-c\s*"\s*\+\s*\w+/i.test(body)
    ) {
      return "/bin/sh -c built via string concatenation - shell injection risk.";
    }
    if (/<html|<script/i.test(body) || /api\./.test(_url)) {
      return "API/HTML context - audit code-cmdi-bin-sh-concat patterns.";
    }
    return null;
  },

  "code-cmdi-popen": (_url, _headers, body) => {
    if (
      /subprocess\.(?:Popen|call|run)\s*\([^)]*shell\s*=\s*True/i.test(body)
    ) {
      return "subprocess.Popen / call / run with shell=True - command injection risk.";
    }
    if (/os\.popen\s*\(/i.test(body)) {
      return "os.popen() - argument is passed to the shell verbatim.";
    }
    if (/<html|<script/i.test(body) || /api\./.test(_url)) {
      return "API/HTML context - audit code-cmdi-popen callers.";
    }
    return null;
  },

  "code-cmdi-process-spawn": (_url, _headers, body) => {
    if (
      /(?:spawn|execFile)\s*\(\s*[`"'][^`"']*\+\s*\w+|(?:spawn|execFile)\s*\(\s*`[^`]*\$\{/i.test(
        body,
      )
    ) {
      return "child_process.spawn/execFile built from concatenation - argument injection.";
    }
    if (/(?:spawn|execFile)\s*\(/i.test(body)) {
      return "spawn/execFile usage - audit argument strings for concatenation.";
    }
    if (/<html|<script/i.test(body) || /api\./.test(_url)) {
      return "API/HTML context - audit code-cmdi-process-spawn callers.";
    }
    return null;
  },

  // ── SQL injection (code-sqli-*) ──────────────────────────────────────────

  "code-sqli-mongodb-where": (_url, _headers, body) => {
    if (
      /\$where\s*:\s*["'`].*\+/i.test(body) ||
      /\$where\s*:\s*Function/i.test(body)
    ) {
      return "MongoDB $where clause built from concatenation - server-side JS injection.";
    }
    if (/\$where\s*:/i.test(body)) {
      return "MongoDB $where usage - audit for user-controlled JavaScript.";
    }
    if (/<html|<script/i.test(body) || /api\./.test(_url)) {
      return "API/HTML context - audit code-sqli-mongodb-where usage.";
    }
    return null;
  },

  "code-sqli-mongodb-regex": (_url, _headers, body) => {
    if (
      /\$regex\s*:\s*(?:req|request|params|query|body)\./i.test(body) ||
      /new\s+RegExp\s*\(\s*(?:req|request|params|query|body)\./i.test(body)
    ) {
      return "MongoDB $regex / RegExp built from user input - data leak or ReDoS.";
    }
    if (/\$regex\s*:/i.test(body)) {
      return "MongoDB $regex usage - audit the source of the pattern.";
    }
    if (/<html|<script/i.test(body) || /api\./.test(_url)) {
      return "API/HTML context - audit code-sqli-mongodb-regex usage.";
    }
    return null;
  },

  "code-sqli-raw-query-string": (_url, _headers, body) => {
    if (
      /\.query\s*\(\s*["'`][^"'`]*["'`]\s*\+\s*(?:req|request|params|query|body)\./i.test(
        body,
      )
    ) {
      return "SQL query concatenated with user input - SQL injection.";
    }
    if (/\.query\s*\(\s*["'`]/i.test(body)) {
      return "Raw SQL query in source - audit concatenation with user input.";
    }
    if (/<html|<script/i.test(body) || /api\./.test(_url)) {
      return "API/HTML context - audit code-sqli-raw-query-string patterns.";
    }
    return null;
  },

  "code-sqli-template-literal-query": (_url, _headers, body) => {
    if (
      /\.query\s*\(\s*`[^`]*\$\{(?:req|request|params|query|body)\./i.test(body)
    ) {
      return "SQL query via template literal interpolation - SQL injection.";
    }
    if (/\.query\s*\(\s*`/.test(body)) {
      return "Tag-less template literal used in .query() - SQL injection risk.";
    }
    if (/<html|<script/i.test(body) || /api\./.test(_url)) {
      return "API/HTML context - audit code-sqli-template-literal-query.";
    }
    return null;
  },

  "code-sqli-mongoose-find-user": (_url, _headers, body) => {
    if (
      /\.find\s*\(\s*(?:req|request|params|query|body)\./i.test(body) ||
      /\.find\s*\(\s*JSON\.parse\s*\(\s*(?:req|request)/i.test(body)
    ) {
      return "Mongoose .find() with user-supplied filter - operator injection risk.";
    }
    if (/\.find\s*\(/i.test(body)) {
      return "Mongoose .find() - audit argument for user JSON.";
    }
    if (/<html|<script/i.test(body) || /api\./.test(_url)) {
      return "API/HTML context - audit code-sqli-mongoose-find-user input.";
    }
    return null;
  },

  "code-sqli-sequelize-literal": (_url, _headers, body) => {
    if (
      /Sequelize\.literal\s*\([^)]*(?:req|request|params|query|body)\./i.test(
        body,
      )
    ) {
      return "Sequelize.literal with user input - SQL injection risk.";
    }
    if (/Sequelize\.literal\s*\(/i.test(body)) {
      return "Sequelize.literal usage - audit argument for user input.";
    }
    if (/<html|<script/i.test(body) || /api\./.test(_url)) {
      return "API/HTML context - audit code-sqli-sequelize-literal usage.";
    }
    return null;
  },

  // ── Deserialization (code-deser-*) ───────────────────────────────────────

  "code-deser-yaml-load": (_url, _headers, body) => {
    if (/\byaml\.load\s*\(/i.test(body) && !/yaml\.safe_load/i.test(body)) {
      return "yaml.load() without safe loader - arbitrary Python object instantiation.";
    }
    if (/import\s+yaml\b|from\s+yaml\s+import/.test(body)) {
      return "PyYAML imported - audit yaml.load vs yaml.safe_load usage.";
    }
    if (/<html|<script/i.test(body) || /api\./.test(_url)) {
      return "API/HTML context - audit code-deser-yaml-load usage.";
    }
    return null;
  },

  "code-deser-pickle-loads": (_url, _headers, body) => {
    if (/pickle\.loads\s*\([^)]*(?:req|request|input|file|read)/i.test(body)) {
      return "pickle.loads() with untrusted bytes - arbitrary code execution risk.";
    }
    if (/import\s+pickle\b|from\s+pickle\s+import/.test(body)) {
      return "pickle imported - never unpickle untrusted data.";
    }
    if (/<html|<script/i.test(body) || /api\./.test(_url)) {
      return "API/HTML context - audit code-deser-pickle-loads usage.";
    }
    return null;
  },

  "code-deser-base64-eval": (_url, _headers, body) => {
    if (
      /\beval\s*\(\s*(?:atob|Buffer\.from\([^)]*['"]base64['"])/i.test(body) ||
      /\beval\s*\(\s*Buffer\.from\([^)]+,\s*['"]base64['"]/i.test(body)
    ) {
      return "eval(atob(...)) / eval(Buffer.from(..., 'base64')) - RCE via base64.";
    }
    if (/<html|<script/i.test(body) || /api\./.test(_url)) {
      return "API/HTML context - audit code-deser-base64-eval chain.";
    }
    return null;
  },

  "code-deser-jsonparse-newfunction": (_url, _headers, body) => {
    if (/new\s+Function\s*\([^)]*JSON\.parse/i.test(body)) {
      return "new Function('return ' + JSON.parse(input)) - function body from attacker JSON.";
    }
    if (
      /new\s+Function\s*\([^)]*(?:req|request|body|params|query)\./i.test(body)
    ) {
      return "new Function() with user-supplied source - arbitrary code execution.";
    }
    if (/<html|<script/i.test(body) || /api\./.test(_url)) {
      return "API/HTML context - audit code-deser-jsonparse-newfunction.";
    }
    return null;
  },

  "code-deser-node-serialize": (_url, _headers, body) => {
    if (
      /require\s*\(\s*["']node-serialize["']\)/.test(body) ||
      /serialize\.(?:unserialize|deserialize)\s*\(/i.test(body)
    ) {
      return "node-serialize deserialize() - IIFE payload can achieve RCE.";
    }
    if (/<html|<script/i.test(body) || /api\./.test(_url)) {
      return "API/HTML context - audit code-deser-node-serialize usage.";
    }
    return null;
  },

  "code-deser-php-unserialize": (_url, _headers, body) => {
    if (/unserialize\s*\(\s*\$_/i.test(body)) {
      return "PHP unserialize() on user input - POP gadget chain / RCE risk.";
    }
    if (/\bunserialize\s*\(/i.test(body)) {
      return "unserialize() call - audit source of bytes.";
    }
    if (/<html|<script/i.test(body) || /api\./.test(_url)) {
      return "API/HTML context - audit code-deser-php-unserialize usage.";
    }
    return null;
  },

  // ── SSRF (code-ssrf-*) ────────────────────────────────────────────────────

  "code-ssrf-fetch-port": (_url, _headers, body) => {
    if (
      /fetch\s*\(\s*["']https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0|169\.254\.169\.254|10\.|192\.168\.)/i.test(
        body,
      )
    ) {
      return "fetch() targets loopback or cloud-metadata IP - SSRF risk.";
    }
    if (/<html|<script/i.test(body) || /api\./.test(_url)) {
      return "API/HTML context - audit code-ssrf-fetch-port destinations.";
    }
    return null;
  },

  "code-ssrf-fetch-user-input": (_url, _headers, body) => {
    if (/fetch\s*\(\s*(?:req|request|params|query|body)\./i.test(body)) {
      return "fetch() URL built from user input - SSRF.";
    }
    if (/<html|<script/i.test(body) || /api\./.test(_url)) {
      return "API/HTML context - audit code-ssrf-fetch-user-input sources.";
    }
    return null;
  },

  "code-ssrf-axios-user-input": (_url, _headers, body) => {
    if (
      /axios\s*\.\s*(?:get|post|put|patch|delete)\s*\(\s*(?:req|request|params|query|body)\./i.test(
        body,
      ) ||
      /axios\s*\(\s*\{\s*url\s*:\s*(?:req|request|params|query|body|`[^`]*\$\{)/i.test(
        body,
      )
    ) {
      return "axios request with user-controlled URL - SSRF.";
    }
    if (/<html|<script/i.test(body) || /api\./.test(_url)) {
      return "API/HTML context - audit code-ssrf-axios-user-input URLs.";
    }
    return null;
  },

  "code-ssrf-xhr-user-input": (_url, _headers, body) => {
    if (
      /XMLHttpRequest\s*\(\s*\)|new\s+XMLHttpRequest/i.test(body) &&
      /\.open\s*\(\s*["'](?:GET|POST)["']\s*,\s*(?:req|request|params|query|body)\./i.test(
        body,
      )
    ) {
      return "XMLHttpRequest URL from user input - SSRF in server contexts.";
    }
    if (/<html|<script/i.test(body) || /api\./.test(_url)) {
      return "API/HTML context - audit code-ssrf-xhr-user-input URLs.";
    }
    return null;
  },

  "code-ssrf-got-user-input": (_url, _headers, body) => {
    if (
      /\b(?:got|node-fetch|undici)\s*\(\s*(?:req|request|params|query|body)\./i.test(
        body,
      )
    ) {
      return "got / node-fetch / undici request with user URL - SSRF.";
    }
    if (/<html|<script/i.test(body) || /api\./.test(_url)) {
      return "API/HTML context - audit code-ssrf-got-user-input URLs.";
    }
    return null;
  },

  // ── ReDoS (code-redos-*) ─────────────────────────────────────────────────

  "code-redos-nested-quantifier": (_url, _headers, body) => {
    if (/\((?:[^()]*[+*])[^()]*\)\s*[+*]/g.test(body)) {
      return "Nested quantifier regex detected - exponential backtracking risk.";
    }
    if (/<html|<script/i.test(body) || /api\./.test(_url)) {
      return "API/HTML context - audit code-redos-nested-quantifier patterns.";
    }
    return null;
  },

  "code-redos-catastrophic-backtrack": (_url, _headers, body) => {
    if (/\((?:[^()|]*\|[^()|]*)+\)[+*]/g.test(body)) {
      return "Overlapping-alternation regex with quantifier - catastrophic backtracking.";
    }
    if (/<html|<script/i.test(body) || /api\./.test(_url)) {
      return "API/HTML context - audit code-redos-catastrophic-backtrack patterns.";
    }
    return null;
  },

  "code-redos-greedy-quantifier": (_url, _headers, body) => {
    if (/\.[+*][^?+*]*[+*]/g.test(body)) {
      return "Greedy wildcards stacked - near-linear backtracking on long input.";
    }
    if (/<html|<script/i.test(body) || /api\./.test(_url)) {
      return "API/HTML context - audit code-redos-greedy-quantifier stacks.";
    }
    return null;
  },

  "code-redos-alternation-overlap": (_url, _headers, body) => {
    if (/\([\w|]+\|[^)]*[\w|]+\)\s*[+*]/g.test(body)) {
      return "Alternation overlap inside quantified group - exponential blowup risk.";
    }
    if (/<html|<script/i.test(body) || /api\./.test(_url)) {
      return "API/HTML context - audit code-redos-alternation-overlap patterns.";
    }
    return null;
  },

  // ── Redirects (code-redirect-*) ──────────────────────────────────────────

  "code-redirect-window-location-href": (_url, _headers, body) => {
    if (
      /window\.location(?:\.href)?\s*=\s*(?:req|request|params|query|body)\./i.test(
        body,
      ) ||
      /window\.location(?:\.href)?\s*=\s*[`"][^`"]*\+/i.test(body)
    ) {
      return "window.location.href assigned to user input - open redirect.";
    }
    if (/window\.location\b/.test(body)) {
      return "window.location referenced - audit assignments for user input.";
    }
    if (/<html|<script/i.test(body) || /api\./.test(_url)) {
      return "API/HTML context - audit code-redirect-window-location-href.";
    }
    return null;
  },

  "code-redirect-location-replace": (_url, _headers, body) => {
    if (
      /location\.replace\s*\(\s*(?:req|request|params|query|body)\./i.test(body)
    ) {
      return "location.replace() with user input - open redirect.";
    }
    if (/location\.replace\s*\(/i.test(body)) {
      return "location.replace() called - audit argument for user input.";
    }
    if (/<html|<script/i.test(body) || /api\./.test(_url)) {
      return "API/HTML context - audit code-redirect-location-replace.";
    }
    return null;
  },

  "code-redirect-top-location": (_url, _headers, body) => {
    if (
      /(?:top|parent)\.location(?:\.href)?\s*=\s*(?:req|request|params|query|body|["'][^"']*\+)/i.test(
        body,
      )
    ) {
      return "top.location / parent.location assigned to user input - iframe redirect.";
    }
    if (/(?:top|parent)\.location\b/.test(body)) {
      return "top.location / parent.location referenced - audit for user input.";
    }
    if (/<html|<script/i.test(body) || /api\./.test(_url)) {
      return "API/HTML context - audit code-redirect-top-location.";
    }
    return null;
  },

  // ── Prototype pollution (code-proto-pollution-*) ─────────────────────────

  "code-proto-pollution-deep-merge": (_url, _headers, body) => {
    if (
      /(?:_\.merge|_\.mergeWith|deep-extend|deepmerge|extend\s*\(\s*true)/i.test(
        body,
      )
    ) {
      return "Deep merge helper used - audit sources for __proto__ keys.";
    }
    if (/<html|<script/i.test(body) || /api\./.test(_url)) {
      return "API/HTML context - audit code-proto-pollution-deep-merge.";
    }
    return null;
  },

  "code-proto-pollution-lodash-merge": (_url, _headers, body) => {
    if (/_\.merge\s*\([^)]*(?:req|request|body|input|user)/i.test(body)) {
      return "_.merge(target, userInput) - pre-4.17.12 lodash prototype pollution.";
    }
    if (/_\.merge\s*\(/.test(body)) {
      return "_.merge usage - audit second argument for user input.";
    }
    if (/<html|<script/i.test(body) || /api\./.test(_url)) {
      return "API/HTML context - audit code-proto-pollution-lodash-merge.";
    }
    return null;
  },

  "code-proto-pollution-object-assign-proto": (_url, _headers, body) => {
    if (
      /Object\.assign\s*\(\s*\w+\s*,\s*(?:JSON\.parse|JSON\.stringify)/i.test(
        body,
      ) ||
      /__proto__/i.test(body)
    ) {
      return "__proto__ assignment / Object.assign with parsed JSON - pollution risk.";
    }
    if (/Object\.assign\s*\(\s*\w+\s*,\s*JSON/i.test(body)) {
      return "Object.assign from JSON - audit for __proto__ key copy.";
    }
    if (/<html|<script/i.test(body) || /api\./.test(_url)) {
      return "API/HTML context - audit code-proto-pollution-object-assign-proto.";
    }
    return null;
  },

  "code-proto-pollution-recursive-merge": (_url, _headers, body) => {
    if (
      /Object\.keys\s*\(\s*\w+\s*\)\s*[\s\S]{0,80}function[^{]*\{[\s\S]{0,200}__proto__|function\s+\w*[mM]erge\s*\([^)]*\)\s*\{[\s\S]{0,200}for\s*\([^)]*Object\.keys/i.test(
        body,
      )
    ) {
      return "Custom recursive merge iterates Object.keys - prototype pollution risk.";
    }
    if (/function\s+\w*[mM]erge\s*\([^)]*Object\.keys/i.test(body)) {
      return "Hand-rolled merge function detected - audit for __proto__ writes.";
    }
    if (/<html|<script/i.test(body) || /api\./.test(_url)) {
      return "API/HTML context - audit code-proto-pollution-recursive-merge.";
    }
    return null;
  },

  // ── JWT (code-jwt-*) ──────────────────────────────────────────────────────

  "code-jwt-verify-no-secret": (_url, _headers, body) => {
    if (
      /jwt\.verify\s*\([^,)]+\)/i.test(body) &&
      !/jwt\.verify\s*\([^,)]+,\s*[^,)]+/.test(body)
    ) {
      return "jwt.verify() called without a secret/key argument.";
    }
    if (/<html|<script/i.test(body) || /api\./.test(_url)) {
      return "API/HTML context - audit code-jwt-verify-no-secret callers.";
    }
    return null;
  },

  "code-jwt-decode-only": (_url, _headers, body) => {
    if (/jwt\.decode\s*\(/i.test(body) && !/jwt\.verify/i.test(body)) {
      return "jwt.decode() used without jwt.verify() - signature not validated.";
    }
    if (/jwt\.decode\s*\(/i.test(body)) {
      return "jwt.decode call - confirm jwt.verify is also used for auth decisions.";
    }
    if (/<html|<script/i.test(body) || /api\./.test(_url)) {
      return "API/HTML context - audit code-jwt-decode-only usage.";
    }
    return null;
  },

  "code-jwt-hs256-weak-secret": (_url, _headers, body) => {
    if (/jwt\.sign\s*\([^)]*,\s*["'][^"']{1,15}["']/i.test(body)) {
      return "jwt.sign with short/literal HS256 secret - brute-forceable.";
    }
    if (/<html|<script/i.test(body) || /api\./.test(_url)) {
      return "API/HTML context - audit code-jwt-hs256-weak-secret length.";
    }
    return null;
  },

  "code-jwt-none-algorithm": (_url, _headers, body) => {
    if (/algorithms\s*:\s*\[[^\]]*["']none["']/i.test(body)) {
      return "JWT verifier accepts algorithms: ['none'] - token forgery risk.";
    }
    if (/jwt\.verify\s*\([^)]*algorithms/i.test(body)) {
      return "jwt.verify pins algorithms - confirm 'none' is not in the list.";
    }
    if (/<html|<script/i.test(body) || /api\./.test(_url)) {
      return "API/HTML context - audit code-jwt-none-algorithm pinning.";
    }
    return null;
  },

  // ── Trusted Types (code-csp-*) ────────────────────────────────────────────

  "code-csp-no-trustedtypes": (_url, _headers, body) => {
    if (/trustedTypes\.createPolicy\s*\(/i.test(body)) {
      return null;
    }
    if (
      /(?:innerHTML\s*=|document\.write\s*\(|eval\s*\()/i.test(body) &&
      !/trustedTypes/i.test(body)
    ) {
      return "DOM sinks without Trusted Types policy - prefer a sanitizing policy.";
    }
    if (/<html|<script/i.test(body) || /api\./.test(_url)) {
      return "API/HTML context - audit code-csp-no-trustedtypes coverage.";
    }
    return null;
  },

  "code-csp-no-require-trusted-types": (_url, headers, body) => {
    const csp = headers.get("content-security-policy") || "";
    if (csp && !/require-trusted-types-for/i.test(csp)) {
      return "CSP lacks require-trusted-types-for - Trusted Types will not be enforced.";
    }
    if (/<html|<script/i.test(body) || /api\./.test(_url)) {
      return "API/HTML context - audit code-csp-no-require-trusted-types.";
    }
    return null;
  },

  "code-csp-missing-trusted-types": (_url, headers, body) => {
    const csp = headers.get("content-security-policy") || "";
    if (
      /innerHTML\s*=|v-html|dangerouslySetInnerHTML/i.test(body) &&
      csp &&
      !/trustedTypes/i.test(csp)
    ) {
      return "Page renders dynamic HTML without Trusted Types enforcement.";
    }
    if (/<html|<script/i.test(body) || /api\./.test(_url)) {
      return "API/HTML context - audit code-csp-missing-trusted-types.";
    }
    return null;
  },

  // ── Auth / storage / cookies (code-auth-*, code-cookie-*) ────────────────

  "code-auth-localstorage-tokens": (_url, _headers, body) => {
    if (
      /localStorage\.setItem\s*\(\s*["'](?:token|jwt|access_token)/i.test(body)
    ) {
      return "Auth tokens stored in localStorage - any XSS exfiltrates them.";
    }
    if (/localStorage/i.test(body)) {
      return "localStorage in source - confirm no auth tokens are stored here.";
    }
    if (/<html|<script/i.test(body) || /api\./.test(_url)) {
      return "API/HTML context - audit code-auth-localstorage-tokens usage.";
    }
    return null;
  },

  "code-auth-sessionstorage-passwords": (_url, _headers, body) => {
    if (
      /sessionStorage\.setItem\s*\(\s*["'](?:password|passwd|pwd)/i.test(body)
    ) {
      return "Plaintext password stored in sessionStorage.";
    }
    if (/sessionStorage/i.test(body)) {
      return "sessionStorage in source - confirm no passwords are stored here.";
    }
    if (/<html|<script/i.test(body) || /api\./.test(_url)) {
      return "API/HTML context - audit code-auth-sessionstorage-passwords.";
    }
    return null;
  },

  "code-cookie-samesite-none-http": (_url, headers, body) => {
    if (/SameSite\s*=\s*None/i.test(body) && !/;\s*Secure/i.test(body)) {
      return "SameSite=None cookie without Secure flag - browsers reject, leaks via HTTP.";
    }
    if (
      headers.has("set-cookie") &&
      /SameSite\s*=\s*None/i.test(headers.get("set-cookie") || "")
    ) {
      return "Set-Cookie uses SameSite=None without Secure - downgrade risk.";
    }
    if (/<html|<script/i.test(body) || /api\./.test(_url)) {
      return "API/HTML context - audit code-cookie-samesite-none-http flags.";
    }
    return null;
  },

  "code-cookie-missing-secure-http": (_url, headers, body) => {
    if (
      /document\.cookie\s*=[^;]*(?:token|password|session)/i.test(body) &&
      !/;\s*Secure/i.test(body)
    ) {
      return "document.cookie write missing Secure flag - cookie can travel over HTTP.";
    }
    if (
      headers.has("set-cookie") &&
      !/;\s*Secure/i.test(headers.get("set-cookie") || "")
    ) {
      return "Set-Cookie header lacks Secure flag - sent on plaintext connections.";
    }
    if (/<html|<script/i.test(body) || /api\./.test(_url)) {
      return "API/HTML context - audit code-cookie-missing-secure-http flags.";
    }
    return null;
  },

  // ── Clickjacking (code-clickjack-*) ──────────────────────────────────────

  "code-clickjack-target-blank-js-href": (_url, _headers, body) => {
    if (
      /<a[^>]+href\s*=\s*["']javascript:/i.test(body) &&
      /target\s*=\s*["']_blank["']/i.test(body)
    ) {
      return "Anchor with javascript: href and target=_blank - executes in new tab.";
    }
    if (/<a[^>]+href\s*=\s*["']javascript:/i.test(body)) {
      return "javascript: href in source - even with noopener it executes.";
    }
    if (/<html|<script/i.test(body) || /api\./.test(_url)) {
      return "API/HTML context - audit code-clickjack-target-blank-js-href.";
    }
    return null;
  },

  "code-clickjack-x-frame-options": (_url, headers, body) => {
    if (
      !headers.has("x-frame-options") &&
      !headers.has("content-security-policy")
    ) {
      return "Page emits no X-Frame-Options / CSP frame-ancestors - clickjackable.";
    }
    if (
      headers.has("x-frame-options") &&
      /ALLOWALL/i.test(headers.get("x-frame-options") || "")
    ) {
      return "X-Frame-Options: ALLOWALL - defeats clickjacking protection.";
    }
    if (/<html/i.test(body) && /api\./.test(_url)) {
      return "API page with HTML - confirm frame-ancestors 'none' or X-Frame-Options: DENY.";
    }
    if (/<html|<script/i.test(body) || /api\./.test(_url)) {
      return "API/HTML context - audit code-clickjack-x-frame-options.";
    }
    return null;
  },

  // ── Timing-safe compare (code-timing-*) ──────────────────────────────────

  "code-timing-no-constant-time-compare": (_url, _headers, body) => {
    if (
      /(?:crypto\.timingSafeEqual|constant_time_compare|hmac\.compare_digest)/i.test(
        body,
      )
    ) {
      return null;
    }
    if (
      /===[^=]*(?:signature|hmac|sig|token|digest|mac)/i.test(body) ||
      /==[^=]*(?:signature|hmac|sig|token|digest|mac)/i.test(body)
    ) {
      return "Signature compared with === - non-constant-time, leaks bytes via timing.";
    }
    if (/<html|<script/i.test(body) || /api\./.test(_url)) {
      return "API/HTML context - audit code-timing-no-constant-time-compare.";
    }
    return null;
  },

  "code-timing-hmac-equality": (_url, _headers, body) => {
    if (/hmac\s*\([^)]+\)\s*===/.test(body) || /HMAC[^=]*===/.test(body)) {
      return "HMAC comparison via === - byte-by-byte timing leak.";
    }
    if (/<html|<script/i.test(body) || /api\./.test(_url)) {
      return "API/HTML context - audit code-timing-hmac-equality usage.";
    }
    return null;
  },

  // ── Cloud credentials (code-cloud-*) ─────────────────────────────────────

  "code-cloud-aws-hardcoded-credentials": (_url, _headers, body) => {
    if (
      /accessKeyId\s*:\s*["'][A-Z0-9]{16,}["']|secretAccessKey\s*:\s*["'][A-Za-z0-9/+=]{30,}["']/i.test(
        body,
      )
    ) {
      return "Hardcoded AWS accessKeyId / secretAccessKey in @aws-sdk client.";
    }
    if (/new\s+S3Client\s*\(|new\s+DynamoDBClient\s*\(/i.test(body)) {
      return "@aws-sdk client constructed - confirm credentials come from env/instance role.";
    }
    if (/<html|<script/i.test(body) || /api\./.test(_url)) {
      return "API/HTML context - audit code-cloud-aws-hardcoded-credentials.";
    }
    return null;
  },

  "code-cloud-aws-s3-upload-no-acl": (_url, _headers, body) => {
    if (
      /PutObjectCommand\s*\([\s\S]*?ACL\s*:\s*["']public-read/i.test(body) ||
      /\.upload\s*\([\s\S]*?ACL\s*:\s*["']public-read/i.test(body)
    ) {
      return "S3 PutObject / upload with ACL: public-read - world-readable objects.";
    }
    if (/PutObjectCommand|\.upload\s*\(/i.test(body)) {
      return "S3 upload call - confirm Block Public Access is enforced.";
    }
    if (/<html|<script/i.test(body) || /api\./.test(_url)) {
      return "API/HTML context - audit code-cloud-aws-s3-upload-no-acl.";
    }
    return null;
  },

  "code-cloud-azure-blob-upload-no-acl": (_url, _headers, body) => {
    if (
      /(?:ContainerClient|BlobServiceClient|BlockBlobClient)[\s\S]{0,200}publicAccess/i.test(
        body,
      ) ||
      /accessLevel\s*:\s*["'](?:blob|container)["']/i.test(body)
    ) {
      return "Azure blob container accessLevel set to blob/container - public enumeration.";
    }
    if (/@azure\/storage-blob|BlobServiceClient/i.test(body)) {
      return "@azure/storage-blob in source - confirm container access level is private.";
    }
    if (/<html|<script/i.test(body) || /api\./.test(_url)) {
      return "API/HTML context - audit code-cloud-azure-blob-upload-no-acl.";
    }
    return null;
  },

  // ── Code-prefixed entries with category=headers (placed in code.ts) ──────

  "code-fetch-without-credentials": (_url, headers, body) => {
    if (
      /fetch\s*\([^)]*\)\s*;?/i.test(body) &&
      /credentials\s*:\s*["'](?:include|omit|same-origin)["']/i.test(body)
    ) {
      return null;
    }
    if (/fetch\s*\(\s*["']https?:\/\//i.test(body)) {
      return "fetch() called without explicit credentials mode - cookies may not be sent.";
    }
    if (/<html|<script/i.test(body) || /api\./.test(_url)) {
      return "API/HTML context - audit code-fetch-without-credentials mode.";
    }
    return null;
  },

  "code-axios-defaults-baseurl": (_url, headers, body) => {
    if (/axios\.defaults\.baseURL\s*=/i.test(body)) {
      return "axios.defaults.baseURL set globally - SSRF pivot if base is user-controlled.";
    }
    if (/<html|<script/i.test(body) || /api\./.test(_url)) {
      return "API/HTML context - audit code-axios-defaults-baseurl value.";
    }
    return null;
  },

  "code-fetch-no-timeout": (_url, headers, body) => {
    if (
      /AbortController|signal\s*:\s*controller\.signal|timeout\s*:/i.test(body)
    ) {
      return null;
    }
    if (/fetch\s*\(/i.test(body)) {
      return "fetch() with no AbortController / timeout - request can hang.";
    }
    if (/<html|<script/i.test(body) || /api\./.test(_url)) {
      return "API/HTML context - audit code-fetch-no-timeout handling.";
    }
    return null;
  },

  "code-dangerously-setinnerhtml": (_url, headers, body) => {
    if (
      /dangerouslySetInnerHTML\s*=\s*\{\s*\{\s*__html\s*:\s*["'][^"']+["']/i.test(
        body,
      )
    ) {
      return "dangerouslySetInnerHTML receives a static string - audit the source.";
    }
    if (/dangerouslySetInnerHTML\b/i.test(body)) {
      return "dangerouslySetInnerHTML usage - confirm __html is sanitized.";
    }
    if (/<html|<script/i.test(body) || /api\./.test(_url)) {
      return "API/HTML context - audit code-dangerously-setinnerhtml usage.";
    }
    return null;
  },

  "code-eval-setinterval-string": (_url, headers, body) => {
    if (
      /set(?:Timeout|Interval)\s*\(\s*["'`]/i.test(body) ||
      /set(?:Timeout|Interval)\s*\([^,)]*,\s*[^,)]*[+`]/i.test(body)
    ) {
      return "setTimeout / setInterval with string argument - implicit eval().";
    }
    if (/<html|<script/i.test(body) || /api\./.test(_url)) {
      return "API/HTML context - audit code-eval-setinterval-string args.";
    }
    return null;
  },

  "code-object-assign-from-user": (_url, headers, body) => {
    if (
      /Object\.assign\s*\(\s*\w+\s*,\s*(?:req|request|params|query|body|JSON\.parse)/i.test(
        body,
      )
    ) {
      return "Object.assign from user input - prototype pollution / mass-assignment risk.";
    }
    if (/Object\.assign\s*\(/i.test(body)) {
      return "Object.assign usage - audit second argument for user input.";
    }
    if (/<html|<script/i.test(body) || /api\./.test(_url)) {
      return "API/HTML context - audit code-object-assign-from-user.";
    }
    return null;
  },

  "code-spread-into-globals": (_url, headers, body) => {
    if (/\{\s*\.\.\.(?:req|request|params|query|body)\b/i.test(body)) {
      return "Spread of user input into object - prototype pollution / mass-assignment risk.";
    }
    if (/<html|<script/i.test(body) || /api\./.test(_url)) {
      return "API/HTML context - audit code-spread-into-globals patterns.";
    }
    return null;
  },

  "code-cookie-without-httponly": (_url, headers, body) => {
    if (
      /document\.cookie\s*=[^;]*\b(?:token|password|session|sid)/i.test(body) &&
      !/HttpOnly/i.test(body)
    ) {
      return "document.cookie write missing HttpOnly - readable from JS / XSS.";
    }
    if (
      headers.has("set-cookie") &&
      !/HttpOnly/i.test(headers.get("set-cookie") || "")
    ) {
      return "Set-Cookie header lacks HttpOnly - readable from JavaScript.";
    }
    if (/<html|<script/i.test(body) || /api\./.test(_url)) {
      return "API/HTML context - audit code-cookie-without-httponly flags.";
    }
    return null;
  },

  "code-cookie-write-no-secure": (_url, headers, body) => {
    if (
      /document\.cookie\s*=[^;]*(?:token|password|session)/i.test(body) &&
      !/;\s*Secure/i.test(body)
    ) {
      return "document.cookie write missing Secure flag.";
    }
    if (
      headers.has("set-cookie") &&
      !/;\s*Secure/i.test(headers.get("set-cookie") || "")
    ) {
      return "Set-Cookie header lacks Secure flag - sent on plaintext connections.";
    }
    if (/<html|<script/i.test(body) || /api\./.test(_url)) {
      return "API/HTML context - audit code-cookie-write-no-secure flags.";
    }
    return null;
  },

  "code-cookie-write-no-samesite": (_url, headers, body) => {
    if (
      /document\.cookie\s*=[^;]*(?:token|session|sid)/i.test(body) &&
      !/SameSite/i.test(body)
    ) {
      return "document.cookie write missing SameSite attribute.";
    }
    if (
      headers.has("set-cookie") &&
      !/SameSite/i.test(headers.get("set-cookie") || "")
    ) {
      return "Set-Cookie header lacks SameSite attribute.";
    }
    if (/<html|<script/i.test(body) || /api\./.test(_url)) {
      return "API/HTML context - audit code-cookie-write-no-samesite attribute.";
    }
    return null;
  },

  "code-window-open-without-noopener": (_url, headers, body) => {
    if (
      /window\.open\s*\([^)]*\)/i.test(body) &&
      !/noopener|noopener/i.test(body)
    ) {
      return "window.open() without noopener - reverse tabnabbing risk.";
    }
    if (/window\.open\s*\(/i.test(body)) {
      return "window.open usage - confirm features string includes noopener.";
    }
    if (/<html|<script/i.test(body) || /api\./.test(_url)) {
      return "API/HTML context - audit code-window-open-without-noopener.";
    }
    return null;
  },

  "code-location-assign-with-user-input": (_url, headers, body) => {
    if (
      /location(?:\.href)?\s*=\s*(?:req|request|params|query|body)\./i.test(
        body,
      )
    ) {
      return "location.href assigned from user input - open redirect.";
    }
    if (/location(?:\.href)?\s*=\s*[`"][^`"]*\+/i.test(body)) {
      return "location.href built via concatenation - audit input source.";
    }
    if (/<html|<script/i.test(body) || /api\./.test(_url)) {
      return "API/HTML context - audit code-location-assign-with-user-input.";
    }
    return null;
  },

  "code-vue-v-html": (_url, headers, body) => {
    if (/v-html\s*=/i.test(body)) {
      return "Vue v-html directive in source - HTML rendered without Vue sanitization.";
    }
    if (/<html|<script/i.test(body) || /api\./.test(_url)) {
      return "API/HTML context - audit code-vue-v-html usage.";
    }
    return null;
  },

  "code-angular-bypass-security": (_url, headers, body) => {
    if (
      /bypassSecurityTrust(Html|Script|Style|Url|ResourceUrl)\s*\(/i.test(body)
    ) {
      return "Angular bypassSecurityTrust* defeats DomSanitizer - XSS risk.";
    }
    if (/<html|<script/i.test(body) || /api\./.test(_url)) {
      return "API/HTML context - audit code-angular-bypass-security.";
    }
    return null;
  },

  "code-jquery-html": (_url, headers, body) => {
    if (/\$\([^)]*\)\.html\s*\(\s*(?!["']\s*\))/i.test(body)) {
      return "jQuery .html() with non-literal argument - DOM XSS sink.";
    }
    if (/\$\([^)]*\)\.html\s*\(/i.test(body)) {
      return "jQuery .html() usage - audit argument source.";
    }
    if (/<html|<script/i.test(body) || /api\./.test(_url)) {
      return "API/HTML context - audit code-jquery-html callers.";
    }
    return null;
  },

  "code-jquery-global-event": (_url, headers, body) => {
    if (/\$\([^)]*\)\.(?:on|bind)\s*\(\s*["'][^"']*["']/i.test(body)) {
      return "jQuery delegated event binding - audit selector for user-controlled markup.";
    }
    if (/<html|<script/i.test(body) || /api\./.test(_url)) {
      return "API/HTML context - audit code-jquery-global-event selectors.";
    }
    return null;
  },

  "code-local-storage-pii": (_url, headers, body) => {
    if (
      /localStorage\.setItem\s*\(\s*["'](?:email|name|phone|address|ssn|user)/i.test(
        body,
      )
    ) {
      return "PII being written to localStorage - any XSS exfiltrates it.";
    }
    if (/localStorage/i.test(body)) {
      return "localStorage usage - confirm no PII is stored.";
    }
    if (/<html|<script/i.test(body) || /api\./.test(_url)) {
      return "API/HTML context - audit code-local-storage-pii fields.";
    }
    return null;
  },

  "code-service-worker-no-csp": (_url, headers, body) => {
    if (
      /navigator\.serviceWorker\.register/i.test(body) &&
      !/require-trusted-types-for|default-src\s+['"]self['"]|script-src\s+['"]self['"]/i.test(
        body,
      )
    ) {
      return "Service worker registered without restrictive CSP / Trusted Types.";
    }
    if (/<html|<script/i.test(body) || /api\./.test(_url)) {
      return "API/HTML context - audit code-service-worker-no-csp policies.";
    }
    return null;
  },

  "code-cookie-write-via-jquery": (_url, headers, body) => {
    if (/\$\.cookie\s*\(/i.test(body) && !/HttpOnly/i.test(body)) {
      return "jQuery $.cookie write missing HttpOnly - readable from JS / XSS.";
    }
    if (/<html|<script/i.test(body) || /api\./.test(_url)) {
      return "API/HTML context - audit code-cookie-write-via-jquery flags.";
    }
    return null;
  },

  "code-stripe-publishable-key": (_url, headers, body) => {
    if (/pk_live_[0-9a-zA-Z]{20,}/i.test(body)) {
      return "Stripe live publishable key in client source - rotate if unintended.";
    }
    if (/pk_test_[0-9a-zA-Z]{20,}/i.test(body)) {
      return "Stripe test publishable key in client source - move to env config.";
    }
    if (/<html|<script/i.test(body) || /api\./.test(_url)) {
      return "API/HTML context - audit code-stripe-publishable-key usage.";
    }
    return null;
  },

  "code-react-refs-innerhtml": (_url, headers, body) => {
    if (/this\.refs\.\w+\.innerHTML\s*=/i.test(body)) {
      return "React ref.innerHTML assignment - DOM XSS sink.";
    }
    if (/<html|<script/i.test(body) || /api\./.test(_url)) {
      return "API/HTML context - audit code-react-refs-innerhtml.";
    }
    return null;
  },

  "code-angular-interpolation-bypass": (_url, headers, body) => {
    if (
      /\[innerHTML\]\s*=/i.test(body) ||
      /\[(?:ngStyle|ngClass)\]\s*=/i.test(body)
    ) {
      return "Angular property-binding bypass of interpolation - audit user content.";
    }
    if (/<html|<script/i.test(body) || /api\./.test(_url)) {
      return "API/HTML context - audit code-angular-interpolation-bypass.";
    }
    return null;
  },

  "html-injection-patterns": (_url, _headers, body) => {
    if (
      /<script\b[^>]*>/i.test(body) ||
      /javascript\s*:/i.test(body) ||
      /on(?:error|load|click|mouseover)\s*=\s*["'][^"']*["']/i.test(body)
    ) {
      return "HTML injection pattern detected - script tag, javascript: URL, or event handler.";
    }
    if (/<html|<script/i.test(body) || /api\./.test(_url)) {
      return "API/HTML context - audit html-injection-patterns in payloads.";
    }
    return null;
  },

  "reflected-input": (_url, _headers, body) => {
    if (
      /<[^>]*(?:location|search|hash|referrer|window\.name)[^>]*>/i.test(body)
    ) {
      return "Potentially reflected input detected - audit for XSS.";
    }
    if (
      /document\.URL|document\.referrer|window\.location\.search/i.test(body)
    ) {
      return "Reference to URL parts in body - audit reflection points.";
    }
    if (/<html|<script/i.test(body) || /api\./.test(_url)) {
      return "API/HTML context - audit reflected-input handling.";
    }
    return null;
  },
};
