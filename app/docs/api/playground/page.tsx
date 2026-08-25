"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ChevronDown,
  Send,
  Loader2,
  Eye,
  EyeOff,
  KeyRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/ui/utils";
import { API } from "@/lib/config/constants";
import {
  DocsHero,
  DocsSection,
  DocsCallout,
  CodeBlock,
  InlineCode,
} from "@/components/docs";
import { useDocsContext } from "@/components/docs/docs-shell";
import {
  buildRequestUrl,
  pathParamNames,
  buildExample,
} from "@/lib/api/playground";
import { CODE_LANGUAGES, buildCodeSample } from "@/lib/api/code-samples";

interface Param {
  name: string;
  in: "path" | "query" | string;
  required?: boolean;
  description?: string;
}

interface Operation {
  method: string;
  path: string;
  summary?: string;
  description?: string;
  params: Param[];
  requestExample?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the OpenAPI doc is an untyped JSON document walked structurally.
type Spec = any;

const METHOD_TONE: Record<string, string> = {
  get: "bg-primary/10 text-primary border-primary/20",
  post: "bg-[hsl(var(--success))]/10 text-[hsl(var(--success))] border-[hsl(var(--success))]/25",
  put: "bg-[hsl(var(--warning))]/10 text-[hsl(var(--warning))] border-[hsl(var(--warning))]/25",
  patch:
    "bg-[hsl(var(--warning))]/10 text-[hsl(var(--warning))] border-[hsl(var(--warning))]/25",
  delete:
    "bg-[hsl(var(--severity-high))]/10 text-[hsl(var(--severity-high))] border-[hsl(var(--severity-high))]/25",
};

function flattenOperations(spec: Spec): { baseUrl: string; ops: Operation[] } {
  const baseUrl: string = spec?.servers?.[0]?.url ?? "";
  const ops: Operation[] = [];
  const paths = (spec?.paths ?? {}) as Record<string, Spec>;
  for (const [path, item] of Object.entries(paths)) {
    const pathParams: Param[] = Array.isArray(item.parameters)
      ? item.parameters
      : [];
    for (const method of ["get", "post", "put", "patch", "delete"]) {
      const op = item[method];
      if (!op) continue;
      const opParams: Param[] = Array.isArray(op.parameters)
        ? op.parameters
        : [];
      const declared = [...pathParams, ...opParams];
      const declaredNames = new Set(declared.map((p) => p.name));
      const params: Param[] = [...declared];
      for (const name of pathParamNames(path)) {
        if (!declaredNames.has(name))
          params.push({ name, in: "path", required: true });
      }

      let requestExample: string | undefined;
      const schema = op.requestBody?.content?.["application/json"]?.schema;
      if (schema) {
        try {
          requestExample = JSON.stringify(buildExample(spec, schema), null, 2);
        } catch {
          requestExample = "{}";
        }
      }

      ops.push({
        method,
        path,
        summary: op.summary,
        description: op.description,
        params,
        requestExample,
      });
    }
  }
  return { baseUrl, ops };
}

const TOC = [
  { id: "setup", label: "Setup", level: 1 },
  { id: "endpoints", label: "Endpoints", level: 1 },
];

export default function ApiPlaygroundPage() {
  const { setActiveSection, setTocItems } = useDocsContext();
  const [spec, setSpec] = useState<Spec | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  // The language the code samples render in, shared across every endpoint so
  // picking "Python" once shows Python everywhere.
  const [lang, setLang] = useState<string>(CODE_LANGUAGES[0].id);
  const observerRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    setTocItems(TOC);
    return () => setTocItems([]);
  }, [setTocItems]);

  useEffect(() => {
    let cancelled = false;
    fetch(API.OPENAPI)
      .then((r) =>
        r.ok ? r.json() : Promise.reject(new Error(String(r.status))),
      )
      .then((data) => {
        if (!cancelled) setSpec(data);
      })
      .catch(() => {
        if (!cancelled) setError("Could not load the API spec. Try again.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Wire the right-rail TOC's active highlight. The Setup and Endpoints
  // sections render regardless of the spec fetch, so attach on mount rather
  // than waiting for (or being defeated by a failed) spec load.
  useEffect(() => {
    observerRef.current = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) setActiveSection(entry.target.id);
        });
      },
      { rootMargin: "-20% 0px -70% 0px", threshold: 0 },
    );
    for (const { id } of TOC) {
      const el = document.getElementById(id);
      if (el) observerRef.current.observe(el);
    }
    return () => observerRef.current?.disconnect();
  }, [setActiveSection]);

  const { baseUrl, ops } = useMemo(
    () => (spec ? flattenOperations(spec) : { baseUrl: "", ops: [] }),
    [spec],
  );

  return (
    <div className="space-y-12">
      <DocsHero
        badge="v3 API"
        title="API Playground"
        description="Send real requests to the VulnRadar API from your browser and copy the same call as ready-to-run code in your language. Driven by the live OpenAPI spec, so it never drifts from the real API."
      />

      <DocsSection id="setup" title="Setup">
        <div className="flex flex-col gap-4">
          <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
            Paste an API key to send live calls (create one under{" "}
            <strong className="text-foreground">Profile &gt; API Keys</strong>).
            The key stays in this browser tab, is sent only to{" "}
            <InlineCode>{baseUrl || "/api/v3"}</InlineCode>, and is never stored
            or logged. Prefer the raw contract? The{" "}
            <Link
              href={API.OPENAPI}
              className="text-primary underline-offset-2 hover:underline"
            >
              OpenAPI 3.1 spec
            </Link>{" "}
            is JSON you can import into Postman, Insomnia, or Bruno.
          </p>

          <DocsCallout variant="warning" title="These are real calls">
            <p>
              Requests run against your own account. A{" "}
              <InlineCode>POST /scan</InlineCode> starts an actual scan and
              counts against your quota.
            </p>
          </DocsCallout>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="api-key" className="text-sm font-medium">
              API key
            </label>
            <div className="relative max-w-md">
              <KeyRound
                aria-hidden
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                id="api-key"
                type={showKey ? "text" : "password"}
                autoComplete="off"
                placeholder="vr_live_..."
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                className="px-9 font-mono text-xs"
              />
              <button
                type="button"
                onClick={() => setShowKey((s) => !s)}
                aria-label={showKey ? "Hide key" : "Show key"}
                aria-pressed={showKey}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showKey ? (
                  <EyeOff className="h-4 w-4" aria-hidden />
                ) : (
                  <Eye className="h-4 w-4" aria-hidden />
                )}
              </button>
            </div>
          </div>
        </div>
      </DocsSection>

      <DocsSection id="endpoints" title="Endpoints">
        {error && (
          <p className="text-sm text-[hsl(var(--severity-high))]">{error}</p>
        )}

        {!spec && !error && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Loading the API spec...
          </div>
        )}

        {spec && (
          <div className="flex flex-col gap-2.5">
            {ops.map((op) => (
              <OperationCard
                key={`${op.method}:${op.path}`}
                op={op}
                baseUrl={baseUrl}
                apiKey={apiKey}
                lang={lang}
                onLangChange={setLang}
              />
            ))}
          </div>
        )}
      </DocsSection>
    </div>
  );
}

function OperationCard({
  op,
  baseUrl,
  apiKey,
  lang,
  onLangChange,
}: {
  op: Operation;
  baseUrl: string;
  apiKey: string;
  lang: string;
  onLangChange: (lang: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pathParams, setPathParams] = useState<Record<string, string>>({});
  const [queryParams, setQueryParams] = useState<Record<string, string>>({});
  const [body, setBody] = useState(op.requestExample ?? "");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ status: number; text: string } | null>(
    null,
  );
  const [sendError, setSendError] = useState<string | null>(null);

  const pathP = op.params.filter((p) => p.in === "path");
  const queryP = op.params.filter((p) => p.in === "query");
  const hasBody =
    op.method !== "get" &&
    op.method !== "delete" &&
    op.requestExample !== undefined;

  const url = buildRequestUrl(baseUrl, op.path, pathParams, queryParams);
  const sample = buildCodeSample(lang, {
    method: op.method,
    url,
    body: hasBody ? body : undefined,
    apiKey,
  });
  const sampleLang =
    CODE_LANGUAGES.find((l) => l.id === lang)?.highlight ?? "bash";

  async function send() {
    setSending(true);
    setSendError(null);
    setResult(null);
    try {
      const headers: Record<string, string> = {};
      if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
      if (hasBody) headers["Content-Type"] = "application/json";
      const res = await fetch(url, {
        method: op.method.toUpperCase(),
        headers,
        body: hasBody ? body : undefined,
      });
      const raw = await res.text();
      let text = raw;
      try {
        text = JSON.stringify(JSON.parse(raw), null, 2);
      } catch {
        /* not JSON; show raw */
      }
      setResult({ status: res.status, text });
    } catch {
      setSendError("Request failed (network, CORS, or an invalid URL).");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-muted/40"
      >
        <span
          className={cn(
            "inline-flex shrink-0 items-center rounded border px-2 py-0.5 text-[11px] font-semibold uppercase",
            METHOD_TONE[op.method] ?? "border-border bg-muted text-foreground",
          )}
        >
          {op.method}
        </span>
        <code className="min-w-0 flex-1 truncate font-mono text-sm text-foreground">
          {op.path}
        </code>
        {op.summary && (
          <span className="hidden truncate text-xs text-muted-foreground sm:block">
            {op.summary}
          </span>
        )}
        <ChevronDown
          aria-hidden
          className={cn(
            "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <div className="flex flex-col gap-4 border-t border-border/60 px-3.5 py-3.5">
          {op.description && (
            <p className="text-xs leading-relaxed text-muted-foreground">
              {op.description}
            </p>
          )}

          {(pathP.length > 0 || queryP.length > 0 || hasBody) && (
            <div className="flex flex-col gap-3">
              {pathP.map((p) => (
                <ParamField
                  key={`path-${p.name}`}
                  label={`${p.name} (path)`}
                  value={pathParams[p.name] ?? ""}
                  onChange={(v) =>
                    setPathParams((s) => ({ ...s, [p.name]: v }))
                  }
                  hint={p.description}
                />
              ))}
              {queryP.map((p) => (
                <ParamField
                  key={`query-${p.name}`}
                  label={`${p.name} (query${p.required ? ", required" : ""})`}
                  value={queryParams[p.name] ?? ""}
                  onChange={(v) =>
                    setQueryParams((s) => ({ ...s, [p.name]: v }))
                  }
                  hint={p.description}
                />
              ))}

              {hasBody && (
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-muted-foreground">
                    Request body (JSON)
                  </label>
                  <textarea
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    spellCheck={false}
                    rows={Math.min(12, body.split("\n").length + 1)}
                    className="rounded-md border border-input bg-background px-2.5 py-2 font-mono text-xs text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </div>
              )}
            </div>
          )}

          {/* Code sample, in the shared language selection. */}
          <div className="flex flex-col gap-1.5">
            <div
              role="tablist"
              aria-label="Code sample language"
              className="flex flex-wrap gap-1"
            >
              {CODE_LANGUAGES.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  role="tab"
                  aria-selected={lang === l.id}
                  onClick={() => onLangChange(l.id)}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                    "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
                    lang === l.id
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  {l.label}
                </button>
              ))}
            </div>
            <CodeBlock code={sample} language={sampleLang} />
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              onClick={send}
              disabled={sending || !apiKey}
              className="h-8 gap-1.5"
            >
              {sending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <Send className="h-3.5 w-3.5" aria-hidden />
              )}
              Send request
            </Button>
            {!apiKey && (
              <span className="text-xs text-muted-foreground">
                Enter an API key above to send.
              </span>
            )}
          </div>

          {sendError && (
            <p className="text-xs text-[hsl(var(--severity-high))]">
              {sendError}
            </p>
          )}

          {result && (
            <div className="flex flex-col gap-1">
              <span
                className={cn(
                  "w-fit rounded px-2 py-0.5 text-[11px] font-semibold",
                  result.status < 300
                    ? "bg-[hsl(var(--success))]/10 text-[hsl(var(--success))]"
                    : "bg-[hsl(var(--severity-high))]/10 text-[hsl(var(--severity-high))]",
                )}
              >
                HTTP {result.status}
              </span>
              <pre className="max-h-80 overflow-auto rounded-md border border-border bg-background px-3 py-2 font-mono text-xs text-foreground">
                {result.text}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ParamField({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-muted-foreground">
        {label}
      </label>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 text-xs"
      />
      {hint && <p className="text-[11px] text-muted-foreground/70">{hint}</p>}
    </div>
  );
}
