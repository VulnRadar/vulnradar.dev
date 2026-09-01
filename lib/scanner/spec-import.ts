/**
 * Turn an API spec (OpenAPI 3, Swagger 2, or a Postman collection) into a list
 * of concrete URLs to scan. Pure and dependency-free so it is safe to import
 * from a route and to unit-test without a network or a database.
 *
 * We scan URLs, not API operations, so the extraction favours real, fetchable
 * addresses: the declared server/base URLs (always useful) plus any path we
 * can turn into a concrete URL. A `{placeholder}` is filled from the value the
 * spec itself declares for that parameter (its `example`, a named `examples`
 * entry, or the schema's `example`/`default`/first `enum` member; for an
 * OpenAPI 3 server variable, its required `default`). Only a placeholder the
 * document declares nothing for is a reason to drop the path: a value we
 * invented would be a guess at somebody else's data. Before this, every
 * templated path was discarded outright, which meant a realistic REST spec
 * (mostly `/users/{id}`-shaped) imported as a handful of targets and the rest
 * of the surface was silently invisible. ref: AUDIT-014#comp-12
 *
 * The result is deduped, https/http only, and capped.
 */

export type SpecFormat = "openapi3" | "swagger2" | "postman" | "unknown";

export interface SpecImportResult {
  format: SpecFormat;
  targets: string[];
}

/** How many targets we return at most, so a huge spec can't fan out endlessly. */
export const MAX_SPEC_TARGETS = 50;

function isHttpUrl(u: string): boolean {
  return /^https?:\/\//i.test(u);
}

function stripTrailingSlash(u: string): string {
  return u.endsWith("/") ? u.slice(0, -1) : u;
}

/** Join a base URL and a path into one URL, tolerating slashes on either side. */
function joinUrl(base: string, path: string): string {
  if (!path) return stripTrailingSlash(base);
  const b = stripTrailingSlash(base);
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${b}${p}`;
}

/** A path is templated (has an unfilled `{param}`) and so is not a real URL. */
function isTemplated(path: string): boolean {
  return path.includes("{") || path.includes("}");
}

/**
 * Follow a local `#/a/b/c` JSON Pointer within the document. Parameter objects
 * are `$ref`d in most hand-written specs (`#/components/parameters/UserId`),
 * so without this the declared example is invisible for exactly the specs that
 * bother to declare one. External refs (another file, a URL) are not followed:
 * this module is deliberately dependency-free and does no I/O.
 */
function resolveLocalRef(spec: Record<string, unknown>, ref: string): unknown {
  if (!ref.startsWith("#/")) return undefined;
  let node: unknown = spec;
  for (const rawSeg of ref.slice(2).split("/")) {
    // RFC 6901 escapes: ~1 is "/" and ~0 is "~", in that order.
    const seg = rawSeg.replace(/~1/g, "/").replace(/~0/g, "~");
    if (!node || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[seg];
  }
  return node;
}

/** A scalar the spec declared, normalised to a non-empty string that cannot
 *  itself leave the URL templated. */
function scalarValue(v: unknown): string | undefined {
  if (
    typeof v !== "string" &&
    typeof v !== "number" &&
    typeof v !== "boolean"
  ) {
    return undefined;
  }
  const s = String(v).trim();
  if (!s || s.includes("{") || s.includes("}")) return undefined;
  return s;
}

/**
 * The value a parameter object declares for itself, ready to drop into a path
 * segment. OpenAPI 3 keeps `example`/`examples` on the parameter and
 * `example`/`default`/`enum` on its schema; Swagger 2 keeps `default`, `enum`
 * and the `x-example` extension on the parameter itself. Percent-encoded so a
 * value containing `/` or `?` fills one segment instead of rewriting the rest
 * of the URL.
 */
function declaredParamValue(
  param: Record<string, unknown>,
): string | undefined {
  const schema =
    param.schema && typeof param.schema === "object"
      ? (param.schema as Record<string, unknown>)
      : {};
  const namedExample =
    param.examples && typeof param.examples === "object"
      ? Object.values(param.examples as Record<string, unknown>).find(
          (e) => e && typeof e === "object" && "value" in (e as object),
        )
      : undefined;

  const candidates: unknown[] = [
    param.example,
    (param as Record<string, unknown>)["x-example"],
    namedExample ? (namedExample as { value?: unknown }).value : undefined,
    schema.example,
    schema.default,
    Array.isArray(schema.enum) ? schema.enum[0] : undefined,
    param.default,
    Array.isArray(param.enum) ? param.enum[0] : undefined,
  ];

  for (const c of candidates) {
    const s = scalarValue(c);
    if (s) return encodeURIComponent(s);
  }
  return undefined;
}

/** Every `{name}` in a path or server URL that the document declares a value
 *  for. Path-item level is read first so an operation-level override does not
 *  displace it; either is equally fine for a URL we only mean to fetch. */
function declaredPathValues(
  spec: Record<string, unknown>,
  pathItem: unknown,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!pathItem || typeof pathItem !== "object") return out;

  const consider = (list: unknown): void => {
    if (!Array.isArray(list)) return;
    for (const raw of list) {
      let p: unknown = raw;
      if (p && typeof p === "object") {
        const ref = (p as { $ref?: unknown }).$ref;
        if (typeof ref === "string") p = resolveLocalRef(spec, ref);
      }
      if (!p || typeof p !== "object") continue;
      const po = p as Record<string, unknown>;
      if (po.in !== "path" || typeof po.name !== "string") continue;
      if (out[po.name] !== undefined) continue;
      const v = declaredParamValue(po);
      if (v !== undefined) out[po.name] = v;
    }
  };

  const item = pathItem as Record<string, unknown>;
  consider(item.parameters);
  for (const method of [
    "get",
    "post",
    "put",
    "patch",
    "delete",
    "head",
    "options",
    "trace",
  ]) {
    const op = item[method];
    if (op && typeof op === "object") {
      consider((op as Record<string, unknown>).parameters);
    }
  }
  return out;
}

/** Substitute `{name}` from `values`. Returns undefined when any placeholder
 *  has no declared value, so the caller drops the path exactly as it used to. */
function fillTemplate(
  template: string,
  values: Record<string, string>,
): string | undefined {
  let unresolved = false;
  const filled = template.replace(/\{([^{}]*)\}/g, (whole, name: string) => {
    const v = values[name.trim()];
    if (v === undefined) {
      unresolved = true;
      return whole;
    }
    return v;
  });
  return unresolved ? undefined : filled;
}

/**
 * An OpenAPI 3 server URL, with any `{variable}` filled from the `variables`
 * map. The spec requires a `default` for every declared server variable, so a
 * templated server URL is normally resolvable straight out of the document.
 * Values are restricted to characters that are legal in a host or path so a
 * hostile default cannot bolt on a query string, credentials, or a second
 * host: they are not percent-encoded, because a variable frequently stands in
 * for a whole `host/basePath` fragment.
 */
function resolveServerUrl(server: Record<string, unknown>): string | undefined {
  const url = typeof server.url === "string" ? server.url : undefined;
  if (!url) return undefined;
  if (!isTemplated(url)) return url;

  const vars =
    server.variables && typeof server.variables === "object"
      ? (server.variables as Record<string, unknown>)
      : {};
  const values: Record<string, string> = {};
  for (const [name, raw] of Object.entries(vars)) {
    if (!raw || typeof raw !== "object") continue;
    const v = raw as { default?: unknown; enum?: unknown };
    const picked =
      scalarValue(v.default) ??
      (Array.isArray(v.enum) ? scalarValue(v.enum[0]) : undefined);
    // No "@" (userinfo would swap the host), no "?", "#", "\" or whitespace.
    if (picked && /^[A-Za-z0-9._~:/-]+$/.test(picked)) values[name] = picked;
  }
  return fillTemplate(url, values);
}

function dedupeCap(urls: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const u of urls) {
    // Reject templated URLs from ANY source here, not just templated paths:
    // an OpenAPI server URL with a `{variable}` (e.g. https://{env}.api...) is
    // no more fetchable than a templated path, and must never reach the scanner.
    if (!isHttpUrl(u) || isTemplated(u)) continue;
    const key = stripTrailingSlash(u);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(key);
    if (out.length >= MAX_SPEC_TARGETS) break;
  }
  return out;
}

function fromOpenApi3(spec: Record<string, unknown>): string[] {
  const servers = Array.isArray(spec.servers) ? spec.servers : [];
  const serverUrls = servers
    .map((s) =>
      s && typeof s === "object"
        ? resolveServerUrl(s as Record<string, unknown>)
        : undefined,
    )
    .filter(
      (u): u is string =>
        typeof u === "string" && isHttpUrl(u) && !isTemplated(u),
    );

  const pathItems =
    spec.paths && typeof spec.paths === "object"
      ? (spec.paths as Record<string, unknown>)
      : {};

  const urls: string[] = [...serverUrls];
  for (const base of serverUrls) {
    for (const [path, item] of Object.entries(pathItems)) {
      if (!isTemplated(path)) {
        urls.push(joinUrl(base, path));
        continue;
      }
      const filled = fillTemplate(path, declaredPathValues(spec, item));
      if (filled) urls.push(joinUrl(base, filled));
    }
  }
  return dedupeCap(urls);
}

function fromSwagger2(spec: Record<string, unknown>): string[] {
  const host = typeof spec.host === "string" ? spec.host : "";
  if (!host) return [];
  const schemes = Array.isArray(spec.schemes)
    ? (spec.schemes as unknown[]).filter(
        (s): s is string => s === "https" || s === "http",
      )
    : [];
  const scheme = schemes.includes("https") ? "https" : (schemes[0] ?? "https");
  const basePath = typeof spec.basePath === "string" ? spec.basePath : "";
  const base = `${scheme}://${host}${basePath}`;

  const pathItems =
    spec.paths && typeof spec.paths === "object"
      ? (spec.paths as Record<string, unknown>)
      : {};

  const urls: string[] = [base];
  for (const [path, item] of Object.entries(pathItems)) {
    if (!isTemplated(path)) {
      urls.push(joinUrl(base, path));
      continue;
    }
    const filled = fillTemplate(path, declaredPathValues(spec, item));
    if (filled) urls.push(joinUrl(base, filled));
  }
  return dedupeCap(urls);
}

function fromPostman(spec: Record<string, unknown>): string[] {
  const urls: string[] = [];

  // A Postman URL is either a raw string or an object with a `raw` field.
  const urlOf = (u: unknown): string | undefined => {
    if (typeof u === "string") return u;
    if (u && typeof u === "object") {
      const raw = (u as { raw?: unknown }).raw;
      if (typeof raw === "string") return raw;
    }
    return undefined;
  };

  // Items nest arbitrarily (folders). Walk them.
  const walk = (items: unknown): void => {
    if (!Array.isArray(items)) return;
    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      const node = item as { item?: unknown; request?: unknown };
      if (Array.isArray(node.item)) {
        walk(node.item);
      } else if (node.request && typeof node.request === "object") {
        const raw = urlOf((node.request as { url?: unknown }).url);
        if (raw && isTemplated(raw) === false && isHttpUrl(raw)) urls.push(raw);
      }
    }
  };

  walk(spec.item);
  return dedupeCap(urls);
}

/**
 * Detect the spec kind and extract scan targets. Returns
 * `{ format: "unknown", targets: [] }` for anything it doesn't recognise.
 */
export function extractTargetsFromSpec(spec: unknown): SpecImportResult {
  if (!spec || typeof spec !== "object") {
    return { format: "unknown", targets: [] };
  }
  const s = spec as Record<string, unknown>;

  if (typeof s.openapi === "string" && s.openapi.startsWith("3")) {
    return { format: "openapi3", targets: fromOpenApi3(s) };
  }
  if (s.swagger === "2.0") {
    return { format: "swagger2", targets: fromSwagger2(s) };
  }
  // A Postman collection: an `info` object plus a top-level `item` array.
  if (s.info && typeof s.info === "object" && Array.isArray(s.item)) {
    return { format: "postman", targets: fromPostman(s) };
  }
  return { format: "unknown", targets: [] };
}
