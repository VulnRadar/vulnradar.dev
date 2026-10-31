/**
 * The User-Agent a recorded fetch or safeFetch call carried, however its
 * headers happened to be shaped: a Headers object, a plain record or a list of
 * pairs. Shared by the suites that assert every request to a scan target names
 * the scanner (see tests/lib/scanner/user-agent.test.ts).
 */
export function userAgentOf(init: RequestInit | undefined): string | null {
  const headers = init?.headers;
  if (!headers) return null;
  if (headers instanceof Headers) return headers.get("user-agent");
  const pairs: [string, string][] = Array.isArray(headers)
    ? (headers as [string, string][])
    : Object.entries(headers as Record<string, string>);
  for (const [name, value] of pairs) {
    if (name.toLowerCase() === "user-agent") return String(value);
  }
  return null;
}
