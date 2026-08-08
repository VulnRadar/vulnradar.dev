/**
 * Parsed view of a scanned response.
 *
 * Built once per scan and handed to every check, so a check can ask "is there
 * a password field in a form that posts over HTTP" instead of running its own
 * regex over the raw body. Building it once also means a 1 MB page is parsed
 * once rather than 600 times, which is what the previous per-detector regex
 * approach amounted to.
 *
 * Everything here is derived from data already fetched. Nothing in this module
 * performs network I/O.
 */

import {
  tokenize,
  toElements,
  type Element,
  type Token,
} from "./html/tokenizer";
import { getSetCookies } from "./_helpers";

export interface ScriptRef {
  /** `src` attribute exactly as written, or null for an inline script. */
  src: string | null;
  /** `src` resolved against the page URL, or null when it cannot be resolved. */
  resolved: string | null;
  /** Origin of `resolved` (`https://cdn.example.com`), or null. */
  origin: string | null;
  /** True when `origin` differs from the page origin. */
  thirdParty: boolean;
  /** Source text for inline scripts, empty string for external ones. */
  code: string;
  integrity: string | null;
  crossOrigin: string | null;
  nonce: string | null;
  type: string | null;
  async: boolean;
  defer: boolean;
  /** Byte offset of the opening tag in the response body. */
  offset: number;
  raw: string;
}

export interface StyleRef {
  href: string;
  resolved: string | null;
  origin: string | null;
  thirdParty: boolean;
  integrity: string | null;
  crossOrigin: string | null;
  raw: string;
}

export interface InputField {
  type: string;
  name: string | null;
  id: string | null;
  autocomplete: string | null;
  value: string | null;
  required: boolean;
  raw: string;
}

export interface FormInfo {
  action: string | null;
  /** `action` resolved against the page URL; the page URL itself when absent. */
  resolvedAction: string | null;
  /** Lowercased method, defaulting to "get" as browsers do. */
  method: string;
  target: string | null;
  autocomplete: string | null;
  enctype: string | null;
  inputs: InputField[];
  passwordFields: InputField[];
  /** Hidden inputs whose name or id looks like an anti-CSRF token. */
  csrfTokens: InputField[];
  /** True when the resolved action uses http:// while the page is https://. */
  submitsOverHttp: boolean;
  /** True when the resolved action points at a different origin. */
  crossOrigin: boolean;
  offset: number;
  raw: string;
}

export interface MetaTag {
  name: string | null;
  property: string | null;
  httpEquiv: string | null;
  content: string | null;
  charset: string | null;
  raw: string;
}

export interface LinkRef {
  rel: string;
  href: string;
  resolved: string | null;
  origin: string | null;
  thirdParty: boolean;
  integrity: string | null;
  raw: string;
}

export interface FrameRef {
  src: string | null;
  resolved: string | null;
  origin: string | null;
  thirdParty: boolean;
  sandbox: string | null;
  allow: string | null;
  raw: string;
}

export interface AnchorRef {
  href: string;
  resolved: string | null;
  origin: string | null;
  thirdParty: boolean;
  target: string | null;
  rel: string | null;
  raw: string;
}

export interface CookieInfo {
  name: string;
  value: string;
  secure: boolean;
  httpOnly: boolean;
  /** Lowercased SameSite value, or null when the attribute is absent. */
  sameSite: string | null;
  path: string | null;
  domain: string | null;
  maxAge: number | null;
  expires: string | null;
  prefix: "__Host-" | "__Secure-" | null;
  /** True when the name looks like a session or auth cookie. */
  sessionLike: boolean;
  raw: string;
}

export interface ParsedCsp {
  /** Directive name to its source list, both lowercased. */
  directives: Record<string, string[]>;
  raw: string;
  reportOnly: boolean;
  /** Source list for a directive, falling back to default-src. */
  effective(directive: string): string[] | null;
}

export interface PageContext {
  url: string;
  origin: string;
  host: string;
  hostname: string;
  path: string;
  isHttps: boolean;
  headers: Headers;
  /** Lowercased content-type without parameters, or empty string. */
  contentType: string;
  isHtml: boolean;
  isJson: boolean;
  /** Raw response body, already capped by the caller. */
  body: string;
  tokens: Token[];
  elements: Element[];
  scripts: ScriptRef[];
  /** Concatenated source of every inline script, newline separated. */
  inlineScript: string;
  stylesheets: StyleRef[];
  links: LinkRef[];
  forms: FormInfo[];
  inputs: InputField[];
  metas: MetaTag[];
  frames: FrameRef[];
  anchors: AnchorRef[];
  /** Text of every HTML comment. */
  comments: string[];
  /** Visible text with script, style and comment content removed. */
  text: string;
  /** Distinct third-party origins referenced by any resource attribute. */
  thirdPartyOrigins: string[];
  cookies: CookieInfo[];
  csp: ParsedCsp | null;
  /** True when the markup looks like a JS framework shell. */
  isFrameworkPage: boolean;
  /** Detected framework name, when one is recognised. */
  framework: string | null;
}

const CSRF_NAME = /csrf|xsrf|_token|authenticity_token|nonce|__requestverif/i;
const SESSION_NAME =
  /^(?:.*[-_.])?(?:sess|session|sid|sessid|jsessionid|phpsessid|asp\.net_sessionid|auth|token|jwt|access_token|refresh_token|remember|login)/i;

function resolveUrl(raw: string, base: string): string | null {
  if (!raw) return null;
  try {
    return new URL(raw, base).href;
  } catch {
    return null;
  }
}

function originOf(resolved: string | null): string | null {
  if (!resolved) return null;
  try {
    const u = new URL(resolved);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.origin;
  } catch {
    return null;
  }
}

function attr(el: Element, name: string): string | null {
  const v = el.attrs[name];
  return v === undefined ? null : v;
}

function boolAttr(el: Element, name: string): boolean {
  return name in el.attrs;
}

/**
 * Parse a Content-Security-Policy header value into directives.
 *
 * Directive names are lowercased; source expressions keep their case because
 * `'nonce-AbC'` and hostnames are case sensitive in practice, but comparisons
 * against keywords should lowercase first.
 */
export function parseCsp(value: string, reportOnly = false): ParsedCsp {
  const directives: Record<string, string[]> = {};
  for (const part of value.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const bits = trimmed.split(/\s+/);
    const name = bits[0].toLowerCase();
    if (name in directives) continue; // first occurrence wins, as browsers do
    directives[name] = bits.slice(1);
  }
  return {
    directives,
    raw: value,
    reportOnly,
    effective(directive: string): string[] | null {
      const key = directive.toLowerCase();
      if (key in directives) return directives[key];
      // Only fetch directives fall back to default-src.
      if (
        key === "frame-ancestors" ||
        key === "base-uri" ||
        key === "form-action"
      )
        return null;
      return directives["default-src"] ?? null;
    },
  };
}

/**
 * Parse a single Set-Cookie header value into its name, value and attributes.
 */
export function parseSetCookie(raw: string): CookieInfo {
  const parts = raw.split(";");
  const first = parts[0] ?? "";
  const eq = first.indexOf("=");
  const name = (eq === -1 ? first : first.slice(0, eq)).trim();
  const value = eq === -1 ? "" : first.slice(eq + 1).trim();

  let secure = false;
  let httpOnly = false;
  let sameSite: string | null = null;
  let path: string | null = null;
  let domain: string | null = null;
  let maxAge: number | null = null;
  let expires: string | null = null;

  for (const p of parts.slice(1)) {
    const t = p.trim();
    const i = t.indexOf("=");
    const key = (i === -1 ? t : t.slice(0, i)).trim().toLowerCase();
    const val = i === -1 ? "" : t.slice(i + 1).trim();
    switch (key) {
      case "secure":
        secure = true;
        break;
      case "httponly":
        httpOnly = true;
        break;
      case "samesite":
        sameSite = val.toLowerCase();
        break;
      case "path":
        path = val;
        break;
      case "domain":
        domain = val;
        break;
      case "max-age": {
        const n = parseInt(val, 10);
        maxAge = Number.isFinite(n) ? n : null;
        break;
      }
      case "expires":
        expires = val;
        break;
    }
  }

  const prefix = name.startsWith("__Host-")
    ? "__Host-"
    : name.startsWith("__Secure-")
      ? "__Secure-"
      : null;

  return {
    name,
    value,
    secure,
    httpOnly,
    sameSite,
    path,
    domain,
    maxAge,
    expires,
    prefix,
    sessionLike: SESSION_NAME.test(name),
    raw,
  };
}

function detectFramework(body: string): string | null {
  if (body.includes("__NEXT_DATA__") || body.includes("/_next/"))
    return "Next.js";
  if (body.includes("__nuxt") || body.includes("/_nuxt/")) return "Nuxt";
  if (/\bng-version=/.test(body)) return "Angular";
  if (body.includes('id="__svelte') || body.includes("/_app/immutable/"))
    return "SvelteKit";
  if (body.includes("data-reactroot") || body.includes("__REACT"))
    return "React";
  if (body.includes("/_astro/")) return "Astro";
  if (body.includes("wp-content") || body.includes("wp-includes"))
    return "WordPress";
  return null;
}

/**
 * Build the parsed context for a response.
 *
 * `body` is expected to already be capped by the caller (the scan route caps
 * at 1 MB). Parsing is linear in the body length.
 */
export function buildPageContext(
  url: string,
  headers: Headers,
  body: string,
): PageContext {
  let parsedUrl: URL | null = null;
  try {
    parsedUrl = new URL(url);
  } catch {
    parsedUrl = null;
  }

  const origin = parsedUrl?.origin ?? "";
  const host = parsedUrl?.host ?? "";
  const hostname = parsedUrl?.hostname ?? "";
  const path = parsedUrl?.pathname ?? "/";
  const isHttps = parsedUrl?.protocol === "https:";

  const rawContentType = (() => {
    try {
      return headers.get("content-type") ?? "";
    } catch {
      return "";
    }
  })();
  const contentType = rawContentType.split(";")[0]!.trim().toLowerCase();
  const isHtml =
    contentType.includes("html") ||
    contentType === "" ||
    contentType.includes("xhtml");
  const isJson = contentType.includes("json") || contentType.endsWith("+json");

  const tokens = isHtml ? tokenize(body) : [];
  const elements = isHtml ? toElements(tokens) : [];

  const scripts: ScriptRef[] = [];
  const stylesheets: StyleRef[] = [];
  const links: LinkRef[] = [];
  const metas: MetaTag[] = [];
  const frames: FrameRef[] = [];
  const anchors: AnchorRef[] = [];
  const inputs: InputField[] = [];
  const thirdParty = new Set<string>();

  const noteOrigin = (o: string | null): boolean => {
    if (!o || !origin) return false;
    if (o === origin) return false;
    thirdParty.add(o);
    return true;
  };

  const readInput = (el: Element): InputField => ({
    type: (attr(el, "type") ?? (el.tag === "input" ? "text" : el.tag))
      .trim()
      .toLowerCase(),
    name: attr(el, "name"),
    id: attr(el, "id"),
    autocomplete: attr(el, "autocomplete")?.toLowerCase() ?? null,
    value: attr(el, "value"),
    required: boolAttr(el, "required"),
    raw: el.raw,
  });

  for (const el of elements) {
    switch (el.tag) {
      case "script": {
        const src = attr(el, "src");
        const resolved = src ? resolveUrl(src, url) : null;
        const scriptOrigin = originOf(resolved);
        scripts.push({
          src,
          resolved,
          origin: scriptOrigin,
          thirdParty: noteOrigin(scriptOrigin),
          code: src ? "" : el.text,
          integrity: attr(el, "integrity"),
          crossOrigin: attr(el, "crossorigin"),
          nonce: attr(el, "nonce"),
          type: attr(el, "type"),
          async: boolAttr(el, "async"),
          defer: boolAttr(el, "defer"),
          offset: el.start,
          raw: el.raw,
        });
        break;
      }
      case "link": {
        const rel = (attr(el, "rel") ?? "").toLowerCase();
        const href = attr(el, "href") ?? "";
        const resolved = href ? resolveUrl(href, url) : null;
        const linkOrigin = originOf(resolved);
        const isThird = noteOrigin(linkOrigin);
        const integrity = attr(el, "integrity");
        links.push({
          rel,
          href,
          resolved,
          origin: linkOrigin,
          thirdParty: isThird,
          integrity,
          raw: el.raw,
        });
        if (rel.split(/\s+/).includes("stylesheet")) {
          stylesheets.push({
            href,
            resolved,
            origin: linkOrigin,
            thirdParty: isThird,
            integrity,
            crossOrigin: attr(el, "crossorigin"),
            raw: el.raw,
          });
        }
        break;
      }
      case "meta":
        metas.push({
          name: attr(el, "name")?.toLowerCase() ?? null,
          property: attr(el, "property")?.toLowerCase() ?? null,
          httpEquiv: attr(el, "http-equiv")?.toLowerCase() ?? null,
          content: attr(el, "content"),
          charset: attr(el, "charset"),
          raw: el.raw,
        });
        break;
      case "iframe":
      case "frame": {
        const src = attr(el, "src");
        const resolved = src ? resolveUrl(src, url) : null;
        const frameOrigin = originOf(resolved);
        frames.push({
          src,
          resolved,
          origin: frameOrigin,
          thirdParty: noteOrigin(frameOrigin),
          sandbox: "sandbox" in el.attrs ? (attr(el, "sandbox") ?? "") : null,
          allow: attr(el, "allow"),
          raw: el.raw,
        });
        break;
      }
      case "a": {
        const href = attr(el, "href");
        if (!href) break;
        const resolved = resolveUrl(href, url);
        const anchorOrigin = originOf(resolved);
        anchors.push({
          href,
          resolved,
          origin: anchorOrigin,
          thirdParty: anchorOrigin !== null && anchorOrigin !== origin,
          target: attr(el, "target"),
          rel: attr(el, "rel"),
          raw: el.raw,
        });
        break;
      }
      case "img":
      case "source":
      case "video":
      case "audio":
      case "embed":
      case "object": {
        const src = attr(el, "src") ?? attr(el, "data");
        if (src) noteOrigin(originOf(resolveUrl(src, url)));
        break;
      }
      case "input":
      case "select":
      case "textarea":
        inputs.push(readInput(el));
        break;
    }
  }

  // Forms need their inputs, which the flat element list cannot express by
  // itself. Walk the token stream instead: everything between a <form> start
  // tag and its end tag belongs to that form. Nested forms are invalid HTML
  // and browsers ignore the inner one, so a single open form is enough.
  const forms: FormInfo[] = [];
  if (isHtml) {
    let open: {
      el: Element | null;
      attrs: Record<string, string>;
      offset: number;
      raw: string;
      fields: InputField[];
    } | null = null;

    const elementByStart = new Map<number, Element>();
    for (const el of elements) elementByStart.set(el.start, el);

    for (const t of tokens) {
      if (t.kind === "start" && t.tag === "form" && !open) {
        open = {
          el: elementByStart.get(t.start) ?? null,
          attrs: t.attrs,
          offset: t.start,
          raw: t.raw,
          fields: [],
        };
        continue;
      }
      if (
        open &&
        t.kind === "start" &&
        (t.tag === "input" || t.tag === "select" || t.tag === "textarea")
      ) {
        const el = elementByStart.get(t.start);
        if (el) open.fields.push(readInput(el));
        continue;
      }
      if (open && t.kind === "end" && t.tag === "form") {
        forms.push(buildForm(open, url, origin, isHttps));
        open = null;
      }
    }
    // An unterminated <form> still describes real inputs; keep it.
    if (open) forms.push(buildForm(open, url, origin, isHttps));
  }

  const comments: string[] = [];
  for (const t of tokens) if (t.kind === "comment") comments.push(t.text);

  const inlineScript = scripts
    .filter((s) => !s.src && s.code.trim().length > 0)
    .map((s) => s.code)
    .join("\n");

  // Visible text: text tokens that are not inside a script or style element.
  let text = "";
  if (isHtml) {
    let suppress = 0;
    for (const t of tokens) {
      if (t.kind === "start" && (t.tag === "script" || t.tag === "style")) {
        if (!t.selfClosing) suppress++;
        continue;
      }
      if (t.kind === "end" && (t.tag === "script" || t.tag === "style")) {
        if (suppress > 0) suppress--;
        continue;
      }
      if (t.kind === "text" && suppress === 0) text += t.text;
    }
    text = text.replace(/\s+/g, " ").trim();
  } else {
    text = body;
  }

  const cookies = getSetCookies(headers).map(parseSetCookie);

  const cspHeader = (() => {
    try {
      return headers.get("content-security-policy");
    } catch {
      return null;
    }
  })();
  const cspReportOnly = (() => {
    try {
      return headers.get("content-security-policy-report-only");
    } catch {
      return null;
    }
  })();
  // A <meta http-equiv="Content-Security-Policy"> is equally binding.
  const cspMeta =
    metas.find((m) => m.httpEquiv === "content-security-policy")?.content ??
    null;

  const csp = cspHeader
    ? parseCsp(cspHeader, false)
    : cspMeta
      ? parseCsp(cspMeta, false)
      : cspReportOnly
        ? parseCsp(cspReportOnly, true)
        : null;

  const framework = detectFramework(body);

  return {
    url,
    origin,
    host,
    hostname,
    path,
    isHttps,
    headers,
    contentType,
    isHtml,
    isJson,
    body,
    tokens,
    elements,
    scripts,
    inlineScript,
    stylesheets,
    links,
    forms,
    inputs,
    metas,
    frames,
    anchors,
    comments,
    text,
    thirdPartyOrigins: [...thirdParty].sort(),
    cookies,
    csp,
    isFrameworkPage: framework !== null,
    framework,
  };
}

function buildForm(
  open: {
    attrs: Record<string, string>;
    offset: number;
    raw: string;
    fields: InputField[];
  },
  url: string,
  origin: string,
  isHttps: boolean,
): FormInfo {
  const action = open.attrs["action"] ?? null;
  const resolvedAction = action ? resolveUrl(action, url) : url;
  const actionOrigin = originOf(resolvedAction);
  const method = (open.attrs["method"] ?? "get").trim().toLowerCase();
  const passwordFields = open.fields.filter((f) => f.type === "password");
  const csrfTokens = open.fields.filter(
    (f) =>
      f.type === "hidden" &&
      ((f.name && CSRF_NAME.test(f.name)) || (f.id && CSRF_NAME.test(f.id))),
  );

  return {
    action,
    resolvedAction,
    method,
    target: open.attrs["target"] ?? null,
    autocomplete: open.attrs["autocomplete"]?.toLowerCase() ?? null,
    enctype: open.attrs["enctype"]?.toLowerCase() ?? null,
    inputs: open.fields,
    passwordFields,
    csrfTokens,
    submitsOverHttp:
      isHttps &&
      resolvedAction !== null &&
      resolvedAction.startsWith("http://"),
    crossOrigin:
      actionOrigin !== null && origin !== "" && actionOrigin !== origin,
    offset: open.offset,
    raw: open.raw,
  };
}
