/**
 * Generic client-side fetch helpers.
 *
 * R9/D3: previously lived in components/admin/api-client.ts but were
 * generic enough for any client component. Now mirrored alongside the
 * server-side lib/api/api-utils.ts so client and server code share a
 * consistent error model and request shape.
 */

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

interface RequestOptions extends Omit<RequestInit, "body"> {
  body?: unknown;
}

// ".", "..", and the percent-encoded spellings the URL parser also treats as
// dot segments ("%2e", ".%2e", "%2e%2e", ...).
const DOT_SEGMENT = /^(?:\.|%2e){1,2}$/i;

/**
 * Whether the path part of a URL has a dot segment. The browser resolves those
 * before the request leaves, so "/api/v3/history/../keys/5/revoke" is a
 * request for /api/v3/keys/5/revoke with the user's cookie and a same-origin
 * Origin header. Callers build these paths from ids, and an id can come from
 * a link; no route here is ever reached through a dot segment on purpose. A
 * backslash counts as a separator because the URL parser treats it as one.
 */
function hasDotSegment(url: string): boolean {
  const path = url.split(/[?#]/, 1)[0];
  return path.split(/[/\\]/).some((segment) => DOT_SEGMENT.test(segment));
}

/**
 * Generic JSON API client. Throws ApiError on non-OK responses, and before
 * sending anything for a path that would climb out of where it was built.
 */
export async function apiClient<T>(
  url: string,
  options?: RequestOptions,
): Promise<T> {
  if (hasDotSegment(url)) {
    throw new ApiError("Refused a request path with a dot segment.", 400);
  }
  const { body, headers, ...rest } = options || {};

  const res = await fetch(url, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    ...rest,
  });

  if (!res.ok) {
    let errorMessage = `API error: ${res.status}`;
    try {
      const errorData = (await res.json()) as { error?: string };
      if (errorData.error) {
        errorMessage = errorData.error;
      }
    } catch {
      // Ignore JSON parse errors
    }
    throw new ApiError(errorMessage, res.status);
  }

  // Some endpoints (e.g. DELETE) may return 204 with no body.
  const text = await res.text();
  return (text ? JSON.parse(text) : (undefined as T)) as T;
}

export function apiGet<T>(
  url: string,
  params?: Record<string, string | number | undefined | null>,
): Promise<T> {
  let fullUrl = url;
  if (params) {
    const searchParams = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        searchParams.set(key, String(value));
      }
    });
    const paramString = searchParams.toString();
    if (paramString) {
      fullUrl = `${url}${url.includes("?") ? "&" : "?"}${paramString}`;
    }
  }
  return apiClient<T>(fullUrl);
}

export function apiPost<T>(
  url: string,
  body?: unknown,
  options?: Omit<RequestOptions, "body" | "method">,
): Promise<T> {
  return apiClient<T>(url, { ...options, method: "POST", body });
}

export function apiPatch<T>(url: string, body?: unknown): Promise<T> {
  return apiClient<T>(url, { method: "PATCH", body });
}

export function apiDelete<T>(url: string, body?: unknown): Promise<T> {
  return apiClient<T>(url, { method: "DELETE", body });
}
