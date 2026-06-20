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

/**
 * Generic JSON API client. Throws ApiError on non-OK responses.
 */
export async function apiClient<T>(
  url: string,
  options?: RequestOptions,
): Promise<T> {
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

export function apiPost<T>(url: string, body?: unknown): Promise<T> {
  return apiClient<T>(url, { method: "POST", body });
}

export function apiPatch<T>(url: string, body?: unknown): Promise<T> {
  return apiClient<T>(url, { method: "PATCH", body });
}

export function apiDelete<T>(url: string, body?: unknown): Promise<T> {
  return apiClient<T>(url, { method: "DELETE", body });
}
