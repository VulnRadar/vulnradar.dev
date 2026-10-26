import { NextResponse } from "next/server";

export const MARKER_HEADER = "x-vr-api-version";

/**
 * Tails that have a v4 file. Everything else under /api/v3 defaults to the
 * internal tree, the same shape as spec 4.2 step 5 (default-to-internal is
 * safe because a path that is not a real route falls into the catch-all).
 */
const V4_TEMPLATES = [
  ["history"],
  ["history", ":id"],
  ["history", ":id", "report"],
  ["scan", "verify"],
];

function matchesV4(segments) {
  return V4_TEMPLATES.some(
    (template) =>
      template.length === segments.length &&
      template.every((part, i) => part.startsWith(":") || part === segments[i]),
  );
}

/**
 * Resolve a pathname the way lib/api/route-registry.ts will. Matching is on
 * the raw, still percent-encoded pathname, and the tail is copied into the
 * canonical path untouched, so an encoded slash inside a segment survives.
 */
export function resolveApiPath(pathname) {
  if (pathname.startsWith("/api/v4/")) return { kind: "v4", path: pathname };
  if (pathname.startsWith("/api/internal/")) {
    return { kind: "internal", path: pathname };
  }
  if (pathname.startsWith("/api/v3/")) {
    const tail = pathname.slice("/api/v3/".length);
    const target = matchesV4(tail.split("/").filter(Boolean))
      ? "v4"
      : "internal";
    return { kind: "alias", target, to: `/api/${target}/${tail}` };
  }
  return { kind: "other", path: pathname };
}

/**
 * Copied from spec 4.2 (S11), not imported: lib/api/rewrite.ts does not exist
 * yet. If the real function changes, change this one with it, because this is
 * the construction the spike proves.
 */
export function aliasRewrite(request, canonicalPath, init) {
  const destination = request.nextUrl.clone();
  destination.pathname = canonicalPath;
  return NextResponse.rewrite(destination, init);
}
