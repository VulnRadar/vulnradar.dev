"use client";

import { useState } from "react";
import { ChevronDown, Loader2, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/ui/utils";
import { CodeBlock } from "./docs-code-block";
import type { EndpointParam } from "./docs-types";

interface EndpointPlaygroundProps {
  endpointId: string;
  path: string;
  pathParams?: EndpointParam[];
  queryParams?: EndpointParam[];
  apiKey: string;
}

interface PlaygroundResult {
  status: number;
  ok: boolean;
  durationMs: number;
  body: string;
}

/**
 * Turns a documented path like "/scan/status/{id}" or the query-embedded
 * "/browser/sessions?id={id}" into a real request path. A param whose
 * `{name}` placeholder appears literally in `path` gets substituted in
 * place (covers both styles above); every other param is appended as a
 * normal query string. Paths that already start with /api/ (the one
 * unversioned exception, GET /api/version) are used as-is instead of
 * getting /api/v3 prepended.
 */
function buildRequestUrl(
  path: string,
  params: EndpointParam[],
  values: Record<string, string>,
): string {
  let resolved = path;
  const embedded = new Set<string>();
  for (const p of params) {
    const placeholder = `{${p.name}}`;
    if (resolved.includes(placeholder)) {
      embedded.add(p.name);
      resolved = resolved
        .split(placeholder)
        .join(encodeURIComponent(values[p.name]?.trim() ?? ""));
    }
  }
  const search = new URLSearchParams();
  for (const p of params) {
    if (embedded.has(p.name)) continue;
    const v = values[p.name]?.trim();
    if (v) search.set(p.name, v);
  }
  const qs = search.toString();
  if (qs) resolved += (resolved.includes("?") ? "&" : "?") + qs;
  const base = resolved.startsWith("/api/") ? "" : "/api/v3";
  return base + resolved;
}

/**
 * Inline "try it" panel for a GET endpoint: fills path/query params, fires
 * a real same-origin fetch with the pasted API key, and shows the actual
 * response. GET-only for now -- POST/PUT/PATCH/DELETE would need a request
 * body editor and carry real side effects (creating a scan, deleting
 * history), which is a bigger and riskier surface than this first pass
 * covers.
 */
export function EndpointPlayground({
  endpointId,
  path,
  pathParams,
  queryParams,
  apiKey,
}: EndpointPlaygroundProps) {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<PlaygroundResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const params = [...(pathParams ?? []), ...(queryParams ?? [])];
  const missingRequired = params.some(
    (p) => p.required && !values[p.name]?.trim(),
  );
  const requestUrl = buildRequestUrl(path, params, values);

  async function send() {
    setLoading(true);
    setError(null);
    setResult(null);
    const started =
      typeof performance !== "undefined" ? performance.now() : Date.now();
    try {
      const res = await fetch(requestUrl, {
        headers: apiKey.trim()
          ? { Authorization: `Bearer ${apiKey.trim()}` }
          : undefined,
        // A request with no session cookie and no Bearer token 307s to
        // /login (middleware.ts) rather than returning 401 JSON -- fetch()
        // follows redirects by default, which would silently swap in the
        // login page's HTML as a fake "200 OK". redirect: "manual" catches
        // that as an opaque redirect below instead of showing it as real
        // endpoint output.
        redirect: "manual",
      });
      if (res.type === "opaqueredirect") {
        const finished =
          typeof performance !== "undefined" ? performance.now() : Date.now();
        setResult({
          status: 0,
          ok: false,
          durationMs: Math.round(finished - started),
          body: "Redirected to sign-in. This endpoint requires authentication -- paste an API key above and try again.",
        });
        return;
      }
      const text = await res.text();
      let body = text;
      try {
        body = JSON.stringify(JSON.parse(text), null, 2);
      } catch {
        // Not JSON -- show the raw response text as-is.
      }
      const finished =
        typeof performance !== "undefined" ? performance.now() : Date.now();
      setResult({
        status: res.status,
        ok: res.ok,
        durationMs: Math.round(finished - started),
        body,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed to send");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="border-t border-border/50 pt-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-primary hover:text-primary/80 transition-colors"
        aria-expanded={open}
      >
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 transition-transform",
            open && "rotate-180",
          )}
          aria-hidden="true"
        />
        Try it live
      </button>

      {open && (
        <div className="mt-3 space-y-3">
          {params.length > 0 && (
            <div className="grid gap-2 sm:grid-cols-2">
              {params.map((p) => (
                <div key={p.name} className="space-y-1">
                  <label
                    htmlFor={`playground-${endpointId}-${p.name}`}
                    className="text-[11px] font-medium text-muted-foreground"
                  >
                    {p.name}
                    {p.required && <span className="text-destructive"> *</span>}
                  </label>
                  <Input
                    id={`playground-${endpointId}-${p.name}`}
                    value={values[p.name] ?? ""}
                    onChange={(e) =>
                      setValues((prev) => ({
                        ...prev,
                        [p.name]: e.target.value,
                      }))
                    }
                    placeholder={p.type}
                    className="h-8 text-xs font-mono bg-background/50 border-border/40"
                  />
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              onClick={send}
              disabled={loading || missingRequired}
              className="h-8 gap-1.5"
            >
              {loading ? (
                <Loader2
                  className="h-3.5 w-3.5 animate-spin"
                  aria-hidden="true"
                />
              ) : (
                <Play className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              {loading ? "Sending…" : "Send request"}
            </Button>
            <code className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground font-mono">
              GET {requestUrl}
            </code>
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}

          {result && (
            <div>
              <div className="mb-1.5 flex items-center gap-2">
                <span
                  className={cn(
                    "rounded border px-1.5 py-0.5 font-mono text-[11px] font-semibold",
                    result.ok
                      ? "border-[hsl(var(--success))]/30 bg-[hsl(var(--success))]/10 text-[hsl(var(--success))]"
                      : result.status >= 500
                        ? "border-destructive/30 bg-destructive/10 text-destructive"
                        : "border-[hsl(var(--warning))]/30 bg-[hsl(var(--warning))]/10 text-[hsl(var(--warning))]",
                  )}
                >
                  {result.status}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  {result.durationMs}ms
                </span>
              </div>
              <CodeBlock code={result.body} language="json" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
