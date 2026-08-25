/**
 * Turn an API spec (OpenAPI 3, Swagger 2, or a Postman collection) into a list
 * of concrete URLs to scan. Pure and dependency-free so it is safe to import
 * from a route and to unit-test without a network or a database.
 *
 * We scan URLs, not API operations, so the extraction favours real, fetchable
 * addresses: the declared server/base URLs (always useful) plus any concrete
 * (non-templated) paths. Paths with `{placeholders}` are skipped because a URL
 * with an unfilled `{id}` in it is not a real target. The result is deduped,
 * https/http only, and capped.
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
      s && typeof s === "object" ? (s as { url?: unknown }).url : undefined,
    )
    .filter(
      (u): u is string =>
        typeof u === "string" && isHttpUrl(u) && !isTemplated(u),
    );

  const paths =
    spec.paths && typeof spec.paths === "object"
      ? Object.keys(spec.paths as Record<string, unknown>)
      : [];

  const urls: string[] = [...serverUrls];
  for (const base of serverUrls) {
    for (const path of paths) {
      if (!isTemplated(path)) urls.push(joinUrl(base, path));
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

  const paths =
    spec.paths && typeof spec.paths === "object"
      ? Object.keys(spec.paths as Record<string, unknown>)
      : [];

  const urls: string[] = [base];
  for (const path of paths) {
    if (!isTemplated(path)) urls.push(joinUrl(base, path));
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
