import { getSetCookies, parseCookieName } from "../_helpers";
import { anyOpenTags, htmlComments, openTagsAt } from "../checks/_tag-scan";
import { startTagAttributes } from "../html/tokenizer";
import type { InventoryAttribute, InventoryInput } from "./types";

/**
 * Reduce a response to what the fingerprint rules can read.
 *
 * One forward pass over the opening tags (`anyOpenTags`, whose cursors only
 * move forward) rather than a regex per marker: the body is attacker-controlled
 * markup of up to 1 MiB, parsed in the same process that serves every other
 * scan, and the pattern shapes this replaces measured 36 to 88 seconds at
 * 32 KB. Every collection below is capped so that a page built to be slow or
 * large costs a bounded amount whatever it contains.
 */

export const MAX_BODY_CHARS = 1_048_576;
export const MAX_TAGS = 20_000;
export const MAX_URLS = 600;
export const MAX_URL_CHARS = 512;
export const MAX_METAS = 200;
export const MAX_ATTRIBUTES = 3_000;
export const MAX_COMMENTS = 100;
export const MAX_COOKIES = 50;
export const MAX_HEADERS = 200;

const MAX_HEADER_VALUES = 20;
const MAX_HEADER_VALUE_CHARS = 2_000;
const MAX_COOKIE_NAME_CHARS = 128;
const MAX_COOKIE_VALUE_CHARS = 512;
const MAX_META_CONTENT_CHARS = 300;
const MAX_ATTRIBUTE_VALUE_CHARS = 200;
const MAX_COMMENT_CHARS = 300;
const MAX_TITLE_CHARS = 300;
const MAX_RAW_URL_CHARS = 2_048;

/**
 * Attributes that carry no product signal and appear on nearly every element.
 * Left out so they do not use up {@link MAX_ATTRIBUTES} before the one that
 * matters, such as a hidden `_token` input at the bottom of a long page.
 */
const NOISE_ATTRIBUTES = new Set([
  "class",
  "style",
  "href",
  "src",
  "srcset",
  "alt",
  "title",
  "content",
  "width",
  "height",
  "loading",
  "rel",
  "target",
  "role",
]);

function parseBase(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/**
 * A URL as a rule should see it: path plus query for the page's own origin,
 * the full URL for any other, or null when it is not an http(s) URL or is a
 * cross-origin URL and the caller only wants the page's own.
 */
function normalizeUrl(
  raw: string,
  base: URL | null,
  sameOriginOnly: boolean,
): string | null {
  const text = raw.trim();
  if (!text || text.length > MAX_RAW_URL_CHARS || text.startsWith("#")) {
    return null;
  }
  let resolved: URL;
  try {
    resolved = base ? new URL(text, base) : new URL(text);
  } catch {
    return null;
  }
  if (resolved.protocol !== "http:" && resolved.protocol !== "https:") {
    return null;
  }
  if (base && resolved.origin === base.origin) {
    return (resolved.pathname + resolved.search).slice(0, MAX_URL_CHARS);
  }
  if (sameOriginOnly) return null;
  return resolved.href.slice(0, MAX_URL_CHARS);
}

function readHeaders(headers: Headers): Map<string, string[]> {
  const out = new Map<string, string[]>();
  try {
    headers.forEach((value, key) => {
      const name = key.toLowerCase();
      if (name === "set-cookie" || out.size >= MAX_HEADERS) return;
      const list = out.get(name) ?? [];
      if (list.length < MAX_HEADER_VALUES) {
        list.push(value.slice(0, MAX_HEADER_VALUE_CHARS));
      }
      out.set(name, list);
    });
  } catch {
    // A Headers-like object that throws on iteration yields no headers; the
    // body rules still run.
  }
  return out;
}

function readCookies(headers: Headers): { name: string; value: string }[] {
  const out: { name: string; value: string }[] = [];
  let raw: string[];
  try {
    raw = getSetCookies(headers);
  } catch {
    return out;
  }
  for (const cookie of raw) {
    if (out.length >= MAX_COOKIES) break;
    const name = parseCookieName(cookie).slice(0, MAX_COOKIE_NAME_CHARS);
    if (!name) continue;
    const equals = cookie.indexOf("=");
    const end = cookie.indexOf(";", equals < 0 ? 0 : equals);
    const value =
      equals < 0
        ? ""
        : cookie.slice(equals + 1, end < 0 ? undefined : end).trim();
    out.push({ name, value: value.slice(0, MAX_COOKIE_VALUE_CHARS) });
  }
  return out;
}

function readTitle(body: string): string {
  const [first] = openTagsAt(body, ["title"]);
  if (!first) return "";
  const from = first.index + first.tag.length;
  const to = body.indexOf("<", from);
  return body
    .slice(from, to < 0 ? from + MAX_TITLE_CHARS : to)
    .slice(0, MAX_TITLE_CHARS)
    .trim();
}

/**
 * Build the input every rule reads. Pure, synchronous and never throws: a
 * malformed header set or body yields less input, not an error. `body` may be
 * empty (a non-HTML or raw-IP target), in which case only headers and cookies
 * carry signal.
 */
export function buildInventoryInput(
  headers: Headers,
  body: string,
  url: string,
): InventoryInput {
  const text =
    body.length > MAX_BODY_CHARS ? body.slice(0, MAX_BODY_CHARS) : body;
  const read = {
    headers: readHeaders(headers) as ReadonlyMap<string, readonly string[]>,
    cookies: readCookies(headers),
  };
  if (!text) {
    return {
      ...read,
      metas: [],
      assets: [],
      attributes: [],
      title: "",
      comments: [],
      body: text,
    };
  }

  const base = parseBase(url);
  const metas: { name: string; content: string }[] = [];
  const attributes: InventoryAttribute[] = [];
  const assets = new Set<string>();
  const seenAttributes = new Set<string>();

  const addAsset = (raw: string | undefined, sameOriginOnly: boolean) => {
    if (raw === undefined || assets.size >= MAX_URLS) return;
    const normalized = normalizeUrl(raw, base, sameOriginOnly);
    if (normalized) assets.add(normalized);
  };

  const tags = anyOpenTags(text);
  const limit = Math.min(tags.length, MAX_TAGS);
  for (let i = 0; i < limit; i++) {
    const tag = tags[i];
    const name = /^<(\w+)/.exec(tag)?.[1]?.toLowerCase();
    if (!name) continue;
    const attrs = startTagAttributes(tag);

    if (name === "meta") {
      const content = (attrs.content ?? "").slice(0, MAX_META_CONTENT_CHARS);
      for (const key of ["name", "property"]) {
        const label = attrs[key];
        if (label && metas.length < MAX_METAS) {
          metas.push({ name: label.trim().toLowerCase(), content });
        }
      }
      continue;
    }

    if (name === "script") addAsset(attrs.src, false);
    else if (name === "link") addAsset(attrs.href, false);
    else if (name === "a") addAsset(attrs.href, true);
    else if (name === "form") addAsset(attrs.action, true);
    else if (name === "img") addAsset(attrs.src, true);

    for (const attrName of Object.keys(attrs)) {
      if (attributes.length >= MAX_ATTRIBUTES) break;
      if (NOISE_ATTRIBUTES.has(attrName) || attrName.startsWith("aria-")) {
        continue;
      }
      const value = attrs[attrName].slice(0, MAX_ATTRIBUTE_VALUE_CHARS);
      const key = `${name}\0${attrName}\0${value}`;
      if (seenAttributes.has(key)) continue;
      seenAttributes.add(key);
      attributes.push({ tag: name, name: attrName, value });
    }
  }

  return {
    ...read,
    body: text,
    metas,
    assets: [...assets],
    attributes,
    title: readTitle(text),
    comments: htmlComments(text)
      .slice(0, MAX_COMMENTS)
      .map((comment) => comment.slice(0, MAX_COMMENT_CHARS)),
  };
}
