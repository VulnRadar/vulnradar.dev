// Pure helpers for the API playground (app/api-playground). Kept apart from
// the page so the request-building and example logic can be unit-tested without
// rendering React or hitting the network.

/** Replace `{name}` segments in an OpenAPI path with the caller's values. */
export function substitutePathParams(
  path: string,
  params: Record<string, string>,
): string {
  return path.replace(/\{([^}]+)\}/g, (_, name: string) => {
    const v = params[name];
    return v ? encodeURIComponent(v) : `{${name}}`;
  });
}

/** Build the full request URL from a base, an OpenAPI path, and params. */
export function buildRequestUrl(
  baseUrl: string,
  path: string,
  pathParams: Record<string, string>,
  queryParams: Record<string, string>,
): string {
  const base = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  const withPath = substitutePathParams(path, pathParams);
  const qs = Object.entries(queryParams)
    .filter(([, v]) => v !== "" && v != null)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
  return `${base}${withPath}${qs ? `?${qs}` : ""}`;
}

/** The `{name}` path parameters declared in an OpenAPI path template. */
export function pathParamNames(path: string): string[] {
  return [...path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
}

type Json = unknown;

/** Follow a local `#/components/...` $ref within the spec. Returns undefined
 *  for a non-local or unresolvable ref. */
export function resolveRef(spec: Json, ref: string): Json {
  if (typeof ref !== "string" || !ref.startsWith("#/")) return undefined;
  let node: Json = spec;
  for (const seg of ref.slice(2).split("/")) {
    if (node && typeof node === "object") {
      node = (node as Record<string, Json>)[seg];
    } else {
      return undefined;
    }
  }
  return node;
}

/**
 * Best-effort example instance for a JSON Schema (resolving one $ref layer at a
 * time), used to prefill a request-body editor. Prefers an explicit `example`,
 * then walks object properties, then falls back to a type-appropriate blank.
 * Guards against $ref cycles with a depth cap.
 */
export function buildExample(spec: Json, schema: Json, depth = 0): Json {
  if (!schema || typeof schema !== "object" || depth > 8) return null;
  const s = schema as Record<string, Json>;

  if (typeof s.$ref === "string") {
    return buildExample(spec, resolveRef(spec, s.$ref), depth + 1);
  }
  if (s.example !== undefined) return s.example;

  // Composition. Neither of these carries `type` or `properties`, so without
  // handling them the switch below falls through to `default: null` and the
  // editor prefills the literal `null` for the whole body. That is the same
  // failure mode the `scanners` example in openapi-spec.ts documents: a
  // prefilled body that looks like a valid request, is not, and costs the
  // developer a real scan to discover.
  //
  // allOf: merge every branch, later branches winning, which is what the
  // keyword means for the object case this spec uses it for.
  if (Array.isArray(s.allOf)) {
    const merged: Record<string, Json> = {};
    for (const branch of s.allOf as Json[]) {
      const part = buildExample(spec, branch, depth + 1);
      if (part && typeof part === "object" && !Array.isArray(part)) {
        Object.assign(merged, part);
      }
    }
    return merged;
  }
  // oneOf/anyOf: an example can only be one of them, so take the first. For a
  // discriminated union that is the primary variant, which is the one a
  // developer most likely wants prefilled.
  const variants = (s.oneOf ?? s.anyOf) as Json[] | undefined;
  if (Array.isArray(variants) && variants.length > 0) {
    return buildExample(spec, variants[0], depth + 1);
  }

  switch (s.type) {
    case "object": {
      const props = (s.properties as Record<string, Json>) || {};
      const out: Record<string, Json> = {};
      for (const [key, propSchema] of Object.entries(props)) {
        out[key] = buildExample(spec, propSchema, depth + 1);
      }
      return out;
    }
    case "array":
      return s.items ? [buildExample(spec, s.items, depth + 1)] : [];
    case "integer":
    case "number":
      return 0;
    case "boolean":
      return false;
    case "string":
      return "";
    default:
      return null;
  }
}
