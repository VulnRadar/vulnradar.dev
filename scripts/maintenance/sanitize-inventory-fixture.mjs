// Turns a raw response capture into a software-inventory fixture that is safe to
// commit.
//
//   node scripts/maintenance/sanitize-inventory-fixture.mjs \
//     --headers <final-hop headers file> --body <body file> \
//     --url https://real.host/login --slug laravel-livewire-billing-portal \
//     [--kind real|synthetic] [--captured-at YYYY-MM-DD] \
//     [--must "Laravel:95"]... [--must-not WordPress]... \
//     [--out tests/fixtures/inventory] [--force] [--dry-run] [--allow-site-name]
//
// It writes <out>/<slug>/{headers.txt,body.html,expect.json}. The layout and
// the rules it applies are in tests/fixtures/inventory/README.md; the short
// version is that a fixture keeps what a fingerprint rule can read (header and
// cookie NAMES, meta, script and link tags, the shape of a token) and nothing
// that identifies the site or opens a session (the host, a cookie value, a
// CSRF token, an email, an IP, a credential).
//
// The capture is attacker-controlled markup, so nothing here uses a pattern
// with an unbounded repeat over input it does not already hold in a bounded
// slice: tags are found with indexOf and handled one bounded slice at a time.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const DEFAULT_OUT = join(repoRoot, "tests", "fixtures", "inventory");

export const PLACEHOLDER_HOST = "example.test";
const HEAD_CAP = 64 * 1024;
const BODY_LEAD = 2048;
const EXTRAS_CAP = 200 * 1024;
const INLINE_SCRIPT_CAP = 4096;
const TAG_CAP = 4000;
const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** Value prefixes that identify a product and carry no secret: Laravel's `{"iv":"` envelope. */
const KEEP_PREFIXES = ["eyJpdiI6"];

/** Headers dropped whole: reporting endpoints and anything that authenticates a request. */
const DROPPED_HEADERS = new Set([
  "report-to",
  "nel",
  "authorization",
  "proxy-authorization",
  "cookie",
]);

const SENSITIVE_HEADER = /token|csrf|request-id|trace|session|secret|auth|key/i;
const SENSITIVE_KEY =
  /pass(?:word|wd)?|secret|token|api[-_]?key|user[-_]?name|login|auth|credential|private/i;
const SENSITIVE_NAME = /token|csrf|nonce|password|secret/i;
const FILE_EXTENSIONS =
  /^(?:png|jpe?g|gif|webp|svg|avif|ico|css|js|mjs|json|map|woff2?|ttf|eot)$/i;

// ── small helpers ───────────────────────────────────────────────────────────

/** Lowercase ASCII only, so every index into the copy is an index into the original. */
function asciiLower(text) {
  return text.replace(/[A-Z]/g, (c) =>
    String.fromCharCode(c.charCodeAt(0) + 32),
  );
}

/** `x` for every character, keeping a product-identifying prefix. */
export function maskSecret(value) {
  for (const prefix of KEEP_PREFIXES) {
    if (value.startsWith(prefix)) {
      return prefix + "x".repeat(value.length - prefix.length);
    }
  }
  return "x".repeat(value.length);
}

/** The scanned host and the registrable domain around it. */
export function siteContext(url) {
  const parsed = new URL(url);
  const host = parsed.hostname.toLowerCase();
  const labels = host.split(".");
  const isIp = /^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(":");
  let registrable = host;
  if (!isIp && labels.length > 2) {
    const secondLevel = new Set([
      "co",
      "com",
      "org",
      "net",
      "gov",
      "edu",
      "ac",
    ]);
    const take =
      labels[labels.length - 1].length === 2 &&
      secondLevel.has(labels[labels.length - 2])
        ? 3
        : 2;
    registrable = labels.slice(-take).join(".");
  }
  const label = isIp ? "" : (registrable.split(".")[0] ?? "");
  return { host, registrable, label, path: parsed.pathname };
}

/**
 * Replace the scanned host with example.test, other subdomains of the same
 * registrable domain with `<sub>.example.test`, and the apex with
 * `apex.example.test`, so same-origin and cross-origin links stay what they
 * were. Walks backwards from each hit with indexOf rather than a pattern whose
 * leading repeat would rescan a long run of dotted labels from every start.
 */
export function replaceHost(text, site) {
  const lower = asciiLower(text);
  const needle = site.registrable;
  let out = "";
  let cursor = 0;
  let from = 0;
  for (;;) {
    const at = lower.indexOf(needle, from);
    if (at === -1) break;
    from = at + needle.length;
    const before = lower[at - 1];
    const after = lower[at + needle.length];
    // Inside a longer name ("notexample.com", "example.community").
    if (before !== undefined && /[a-z0-9-]/.test(before)) continue;
    if (after !== undefined && /[a-z0-9-]/.test(after)) continue;
    let start = at;
    while (
      start > cursor &&
      at - start < 253 &&
      /[a-z0-9.-]/.test(lower[start - 1])
    ) {
      start--;
    }
    let sub = lower.slice(start, at);
    // A leading dot or hyphen is punctuation around the name, not a label.
    sub = sub.replace(/^[.-]+/, "");
    const prefixEnd = at - sub.length;
    const full = sub + needle;
    const replacement =
      full === site.host
        ? PLACEHOLDER_HOST
        : sub === ""
          ? `apex.${PLACEHOLDER_HOST}`
          : `${sub}${PLACEHOLDER_HOST}`;
    out += text.slice(cursor, prefixEnd) + replacement;
    cursor = at + needle.length;
  }
  return out + text.slice(cursor);
}

function scrubEmails(text) {
  return text.replace(
    /[A-Za-z0-9._%+-]{1,64}@([A-Za-z0-9.-]{1,255})\.([A-Za-z]{2,24})/g,
    (match, domain, tld) =>
      FILE_EXTENSIONS.test(tld) && !domain.includes(".")
        ? match
        : `user@${PLACEHOLDER_HOST}`,
  );
}

function scrubIps(text) {
  const v4 = text.replace(
    /\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/g,
    (match, offset, whole) => {
      if (match.split(".").some((part) => Number(part) > 255)) return match;
      const before = whole[offset - 1];
      const beforeThat = whole[offset - 2];
      const after = whole[offset + match.length];
      // "jquery-1.2.3.4.js", "ver=1.2.3.4" and "v1.2.3.4" are versions.
      if (before !== undefined && /[A-Za-z0-9._=-]/.test(before)) return match;
      if (before === "/" && beforeThat !== "/") return match;
      if (after !== undefined && /[A-Za-z0-9_-]/.test(after)) return match;
      if (after === "." && /\d/.test(whole[offset + match.length + 1] ?? "")) {
        return match;
      }
      return "192.0.2.1";
    },
  );
  return v4.replace(
    /\b(?:[0-9a-fA-F]{1,4}:){3,7}[0-9a-fA-F]{1,4}\b/g,
    "2001:db8::1",
  );
}

function scrubTokens(text) {
  return text
    .replace(
      /\beyJ[A-Za-z0-9_-]{8,512}\.[A-Za-z0-9_-]{8,512}\.[A-Za-z0-9_-]{8,512}/g,
      (match) => maskSecret(match),
    )
    .replace(
      /'nonce-([A-Za-z0-9+/=_-]{1,200})'/g,
      (_m, nonce) => `'nonce-${maskSecret(nonce)}'`,
    )
    .replace(/(Bearer\s+)([A-Za-z0-9._~+/=-]{8,512})/g, (_m, lead, token) => {
      return lead + maskSecret(token);
    })
    .replace(
      /"([^"\\]{1,64})"(\s*:\s*)"([^"\\]{1,512})"/g,
      (match, key, colon, value) =>
        SENSITIVE_KEY.test(key)
          ? `"${key}"${colon}"${maskSecret(value)}"`
          : match,
    );
}

/** Everything personal that is not specific to one place in the document. */
function scrubText(text, site) {
  return replaceHost(scrubIps(scrubEmails(scrubTokens(text))), site);
}

// ── headers ─────────────────────────────────────────────────────────────────

/** The `Name: value` lines of the last response in a capture that followed redirects. */
export function finalHop(text) {
  const blocks = text
    .split(/\r?\n\r?\n/)
    .map((block) => block.trim())
    .filter((block) => /^HTTP\//i.test(block));
  return blocks[blocks.length - 1] ?? "";
}

function sanitizeSetCookie(value, site) {
  const equals = value.indexOf("=");
  if (equals <= 0) return scrubText(value, site);
  const name = value.slice(0, equals).trim();
  const rest = value.slice(equals + 1);
  const semicolon = rest.indexOf(";");
  const secret = semicolon === -1 ? rest : rest.slice(0, semicolon);
  const attributes = semicolon === -1 ? "" : rest.slice(semicolon);
  // The NAME is kept, because it is what rules match. It is checked by eye in
  // review for a customer's name: renaming it here would break fixtures such as
  // paymenter_session on paymenter.org, which are named for the product.
  return `${name}=${maskSecret(secret.trim())}${replaceHost(attributes, site)}`;
}

/**
 * Sanitized final-hop headers: host replaced, cookie values and token headers
 * masked, cf-ray flattened, reporting and credential headers dropped.
 */
export function sanitizeHeaders(text, site) {
  const block = finalHop(text);
  if (!block) throw new Error("No HTTP response found in the headers file.");
  const lines = block.split(/\r?\n/);
  const out = [scrubText(lines[0].trim(), site)];
  for (const line of lines.slice(1)) {
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const name = line.slice(0, colon).trim();
    const lowerName = name.toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (DROPPED_HEADERS.has(lowerName)) continue;
    if (lowerName === "set-cookie") {
      out.push(`${name}: ${sanitizeSetCookie(value, site)}`);
    } else if (lowerName === "cf-ray") {
      out.push(`${name}: 0000000000000000-XXX`);
    } else if (
      SENSITIVE_HEADER.test(lowerName) &&
      lowerName !== "www-authenticate"
    ) {
      out.push(`${name}: ${maskSecret(value)}`);
    } else {
      out.push(`${name}: ${scrubText(value, site)}`);
    }
  }
  return `${out.join("\n")}\n`;
}

// ── body ────────────────────────────────────────────────────────────────────

/** Visit each opening tag with its offsets. `visit` returns nothing; the scan only moves forward. */
function forEachOpenTag(html, visit) {
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf("<", i);
    if (lt === -1) return;
    let nameEnd = lt + 1;
    while (
      nameEnd < html.length &&
      nameEnd - lt <= 32 &&
      /[A-Za-z0-9]/.test(html[nameEnd])
    ) {
      nameEnd++;
    }
    if (nameEnd === lt + 1) {
      i = lt + 1;
      continue;
    }
    const gt = html.indexOf(">", nameEnd);
    if (gt === -1 || gt - lt > TAG_CAP) {
      i = lt + 1;
      continue;
    }
    visit({
      start: lt,
      end: gt + 1,
      name: html.slice(lt + 1, nameEnd).toLowerCase(),
      text: html.slice(lt, gt + 1),
    });
    i = gt + 1;
  }
}

function maskAttribute(tag, attribute) {
  return tag
    .replace(
      new RegExp(`(\\b${attribute}\\s*=\\s*")([^"]*)(")`, "i"),
      (_m, a, v, b) => a + maskSecret(v) + b,
    )
    .replace(
      new RegExp(`(\\b${attribute}\\s*=\\s*')([^']*)(')`, "i"),
      (_m, a, v, b) => a + maskSecret(v) + b,
    );
}

function tagAttribute(tag, name) {
  const match = new RegExp(
    `\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`,
    "i",
  ).exec(tag);
  return match ? (match[1] ?? match[2]) : undefined;
}

/** Mask the value of a token-like meta or input, and any nonce or token-ish data attribute. */
function scrubTag(tag, name) {
  let out = tag;
  if (name === "meta") {
    const label =
      tagAttribute(tag, "name") ?? tagAttribute(tag, "property") ?? "";
    if (SENSITIVE_NAME.test(label)) out = maskAttribute(out, "content");
  } else if (name === "input") {
    const label = tagAttribute(tag, "name") ?? "";
    const type = tagAttribute(tag, "type") ?? "";
    if (SENSITIVE_NAME.test(label) || type.toLowerCase() === "password") {
      out = maskAttribute(out, "value");
    }
  }
  return out.replace(
    /(\s(?:nonce|data-[a-z-]{0,40}(?:token|csrf|key)[a-z-]{0,40})\s*=\s*)("[^"]*"|'[^']*')/gi,
    (_m, lead, quoted) =>
      lead + quoted[0] + maskSecret(quoted.slice(1, -1)) + quoted[0],
  );
}

function scrubTags(html) {
  let out = "";
  let cursor = 0;
  forEachOpenTag(html, (tag) => {
    const scrubbed = scrubTag(tag.text, tag.name);
    if (scrubbed === tag.text) return;
    out += html.slice(cursor, tag.start) + scrubbed;
    cursor = tag.end;
  });
  return out + html.slice(cursor);
}

/**
 * Remove the `config` object from `window.SiteConfiguration = {...}`. The
 * Pterodactyl demo page inlines demo logins there; the product name, which is
 * what the rule reads, is kept.
 */
export function stripSiteConfigurationConfig(html) {
  const at = html.indexOf("window.SiteConfiguration");
  if (at === -1) return html;
  const key = html.indexOf('"config"', at);
  if (key === -1 || key - at > 20000) return html;
  const open = html.indexOf("{", key);
  if (open === -1) return html;
  let depth = 0;
  let inString = false;
  for (let i = open; i < html.length; i++) {
    const char = html[i];
    if (inString) {
      if (char === "\\") i++;
      else if (char === '"') inString = false;
    } else if (char === '"') inString = true;
    else if (char === "{") depth++;
    else if (char === "}") {
      depth--;
      if (depth === 0) return `${html.slice(0, open)}{}${html.slice(i + 1)}`;
    }
  }
  return html;
}

/**
 * Cut a body down to what rules read: the whole `<head>`, every script, link,
 * meta, hidden input and form tag, and the first 2 KB of `<body>`. An inline
 * script keeps its first 4 KB, because that is where a product puts its own
 * name (`window.SiteConfiguration`).
 */
export function reduceBody(html) {
  const lower = asciiLower(html);
  const headStart = lower.indexOf("<head");
  const headClose = lower.indexOf("</head>", headStart + 1);
  const hasHead = headStart !== -1 && headClose !== -1;
  const excluded = [];
  let head = "";
  if (hasHead) {
    const headEnd = headClose + "</head>".length;
    head = html.slice(headStart, Math.min(headEnd, headStart + HEAD_CAP));
    excluded.push([headStart, headEnd]);
  }
  const bodyOpen = lower.indexOf("<body", hasHead ? headClose : 0);
  let lead = "";
  if (bodyOpen !== -1) {
    const bodyGt = html.indexOf(">", bodyOpen);
    if (bodyGt !== -1) {
      lead = html.slice(bodyGt + 1, bodyGt + 1 + BODY_LEAD);
      excluded.push([bodyOpen, bodyGt + 1 + BODY_LEAD]);
    }
  } else {
    lead = html.slice(0, BODY_LEAD);
    excluded.push([0, BODY_LEAD]);
  }
  const isExcluded = (index) =>
    excluded.some(([a, b]) => index >= a && index < b);

  const extras = [];
  let size = 0;
  forEachOpenTag(html, (tag) => {
    if (size >= EXTRAS_CAP || isExcluded(tag.start)) return;
    let keep = null;
    if (tag.name === "link" || tag.name === "meta" || tag.name === "form") {
      keep = tag.text;
    } else if (
      tag.name === "input" &&
      /type\s*=\s*["']?hidden/i.test(tag.text)
    ) {
      keep = tag.text;
    } else if (tag.name === "script") {
      if (/\bsrc\s*=/i.test(tag.text) || /\/\s*>$/.test(tag.text)) {
        keep = `${tag.text}</script>`;
      } else {
        const close = lower.indexOf("</script", tag.end);
        const stop = close === -1 ? html.length : close;
        const inline = html.slice(
          tag.end,
          Math.min(stop, tag.end + INLINE_SCRIPT_CAP),
        );
        keep = `${tag.text}${inline}</script>`;
      }
    }
    if (keep) {
      extras.push(keep);
      size += keep.length;
    }
  });

  const htmlOpen =
    /<html\b[^>]{0,500}>/i.exec(html.slice(0, 4000))?.[0] ?? "<html>";
  return [
    "<!doctype html>",
    htmlOpen,
    head,
    "<body>",
    lead,
    ...extras,
    "</body>",
    "</html>",
    "",
  ].join("\n");
}

export function sanitizeBody(html, site) {
  const reduced = reduceBody(html);
  return `${scrubText(scrubTags(stripSiteConfigurationConfig(reduced)), site).trimEnd()}\n`;
}

// ── fixture ─────────────────────────────────────────────────────────────────

export function parseMust(entry) {
  const [name, confidence] = entry.split(":");
  const must = { name: name.trim() };
  if (confidence !== undefined && confidence.trim() !== "") {
    const minConfidence = Number(confidence);
    if (
      !Number.isInteger(minConfidence) ||
      minConfidence < 1 ||
      minConfidence > 100
    ) {
      throw new Error(
        `--must "${entry}": the confidence must be a whole number from 1 to 100.`,
      );
    }
    must.minConfidence = minConfidence;
  }
  if (!must.name) throw new Error(`--must "${entry}" names no product.`);
  return must;
}

/**
 * Everything the three files hold, as strings, without touching the disk.
 *
 * @param {{
 *   headersText: string,
 *   bodyHtml: string,
 *   url: string,
 *   slug: string,
 *   kind?: string,
 *   capturedAt?: string,
 *   must?: { name: string, minConfidence?: number }[],
 *   mustNot?: string[],
 *   allowSiteName?: boolean,
 * }} options
 */
export function sanitizeCapture({
  headersText,
  bodyHtml,
  url,
  slug,
  kind = "real",
  capturedAt = new Date().toISOString().slice(0, 10),
  must = [],
  mustNot = [],
  allowSiteName = false,
}) {
  if (!SLUG.test(slug)) {
    throw new Error(
      `Slug "${slug}" must be lowercase letters, digits and hyphens, at most 64 characters.`,
    );
  }
  if (kind !== "real" && kind !== "synthetic") {
    throw new Error(`--kind must be "real" or "synthetic", not "${kind}".`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(capturedAt)) {
    throw new Error("--captured-at must look like 2026-10-31.");
  }
  const site = siteContext(url);
  if (!allowSiteName && site.label.length >= 4 && slug.includes(site.label)) {
    throw new Error(
      `Slug "${slug}" contains "${site.label}", the name of the site it was captured from. Name a fixture after the stack, for example laravel-livewire-billing-portal. ` +
        "When the site is the product's own public demo (demo.paymenter.org for paymenter-default), pass --allow-site-name.",
    );
  }
  const expect = {
    kind,
    capturedAt,
    url: `https://${PLACEHOLDER_HOST}${site.path}`,
    must,
    mustNot,
  };
  return {
    headers: sanitizeHeaders(headersText, site),
    body: sanitizeBody(bodyHtml, site),
    expect: `${JSON.stringify(expect, null, 2)}\n`,
  };
}

export function run(argv, io = { log: console.log, error: console.error }) {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        headers: { type: "string" },
        body: { type: "string" },
        url: { type: "string" },
        slug: { type: "string" },
        kind: { type: "string", default: "real" },
        "captured-at": { type: "string" },
        must: { type: "string", multiple: true, default: [] },
        "must-not": { type: "string", multiple: true, default: [] },
        out: { type: "string", default: DEFAULT_OUT },
        force: { type: "boolean", default: false },
        "dry-run": { type: "boolean", default: false },
        "allow-site-name": { type: "boolean", default: false },
      },
    }));
  } catch (error) {
    io.error(error.message);
    return 1;
  }
  for (const required of ["headers", "body", "url", "slug"]) {
    if (!values[required]) {
      io.error(
        `Missing --${required}. See the comment at the top of this script.`,
      );
      return 1;
    }
  }
  let result;
  try {
    result = sanitizeCapture({
      headersText: readFileSync(values.headers, "utf8"),
      bodyHtml: readFileSync(values.body, "utf8"),
      url: values.url,
      slug: values.slug,
      kind: values.kind,
      capturedAt: values["captured-at"],
      must: values.must.map(parseMust),
      mustNot: values["must-not"],
      allowSiteName: values["allow-site-name"],
    });
  } catch (error) {
    io.error(error.message);
    return 1;
  }
  const dir = join(resolve(values.out), values.slug);
  if (values["dry-run"]) {
    io.log(
      `Would write ${dir} (${result.headers.length + result.body.length} characters)`,
    );
    return 0;
  }
  if (existsSync(dir) && !values.force) {
    io.error(`${dir} already exists. Pass --force to replace it.`);
    return 1;
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "headers.txt"), result.headers);
  writeFileSync(join(dir, "body.html"), result.body);
  writeFileSync(join(dir, "expect.json"), result.expect);
  io.log(`Wrote ${dir}`);
  if (values.must.length === 0) {
    io.log(
      "expect.json has no `must` entries yet: add what the engine has to find.",
    );
  }
  io.log(
    "Read headers.txt and body.html before committing: check cookie names for a customer's name.",
  );
  return 0;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exitCode = run(process.argv.slice(2));
}
