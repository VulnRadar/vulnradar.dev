"use client";

import { useState } from "react";
import {
  Loader2,
  ImageIcon,
  AlertTriangle,
  ExternalLink,
  Code2,
  Copy,
  Check,
  Globe2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { API, APP_NAME } from "@/lib/config/constants";
import { copyToClipboard as copyTextToClipboard } from "@/lib/ui/clipboard";
import type { ScanEntry } from "./badge-types";
import { parseUrl } from "./badge-types";

interface BadgePreviewProps {
  selected: ScanEntry | null;
  token: string | null;
  generating: boolean;
  onScopeChange?: (scope: "user" | "global") => void;
}

function ScopeToggle({
  url,
  scope,
  onScopeChange,
}: {
  url: string;
  scope: "user" | "global";
  onScopeChange?: (scope: "user" | "global") => void;
}) {
  const [pending, setPending] = useState(false);
  const isGlobal = scope === "global";

  async function toggle(checked: boolean) {
    const next = checked ? "global" : "user";
    setPending(true);
    try {
      const res = await fetch(API.BADGE_SITE, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url, scope: next }),
      });
      if (res.ok) onScopeChange?.(next);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/30 p-3">
      <Globe2
        className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5"
        aria-hidden="true"
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-3">
          <label
            htmlFor="badge-scope-toggle"
            className="text-sm font-medium text-foreground"
          >
            Update from anyone&apos;s scan
          </label>
          <Switch
            id="badge-scope-toggle"
            checked={isGlobal}
            disabled={pending}
            onCheckedChange={toggle}
          />
        </div>
        <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
          {isGlobal
            ? "On: the badge shows the newest scan of this URL by anyone, not just you. Their notes and identity stay private, only the findings summary shows."
            : "Off: the badge only updates when you scan this URL yourself. Turn this on if other people also scan it and you want the badge to stay current either way."}
        </p>
      </div>
    </div>
  );
}

function SnippetBlock({
  label,
  icon: Icon,
  code,
  copied,
  onCopy,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  code: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/50">
        <span className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
          <Icon className="h-3 w-3" />
          {label}
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={onCopy}
          className="h-6 px-2 gap-1 text-xs"
        >
          {copied ? (
            <>
              <Check className="h-3 w-3 text-emerald-500" />
              Copied
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" />
              Copy
            </>
          )}
        </Button>
      </div>
      <pre className="p-3 overflow-x-auto">
        <code className="text-xs font-mono text-foreground/80 whitespace-pre-wrap break-all">
          {code}
        </code>
      </pre>
    </div>
  );
}

export function BadgePreview({
  selected,
  token,
  generating,
  onScopeChange,
}: BadgePreviewProps) {
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const badgeUrl = token ? `${origin}${API.BADGE}/${token}` : "";
  const shareUrl = token ? `${origin}/shared/${token}` : "";
  const htmlSnippet = token
    ? `<a href="${shareUrl}" target="_blank" rel="noopener noreferrer" style="display: inline-block;"><img src="${badgeUrl}" alt="Secured by ${APP_NAME}" style="border: 0;"/></a>`
    : "";
  const markdownSnippet = token
    ? `[![Secured by ${APP_NAME}](${badgeUrl})](${shareUrl})`
    : "";

  async function copyToClipboard(text: string, field: string) {
    if (await copyTextToClipboard(text)) {
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    }
  }

  if (!selected) {
    return (
      <div className="flex flex-col gap-4">
        <h2 className="text-sm font-medium text-foreground">Badge preview</h2>
        <div className="rounded-xl border border-dashed border-border bg-card/50 p-12 flex flex-col items-center justify-center gap-3 min-h-[300px]">
          <ImageIcon
            className="h-7 w-7 text-muted-foreground/50"
            aria-hidden="true"
          />
          <p className="text-sm text-muted-foreground text-center">
            Pick a scan on the left to preview its badge
          </p>
        </div>
      </div>
    );
  }

  if (generating) {
    return (
      <div className="flex flex-col gap-4">
        <h2 className="text-sm font-medium text-foreground">Badge preview</h2>
        <div
          className="rounded-xl border border-border bg-card p-12 flex flex-col items-center justify-center gap-3 min-h-[300px]"
          role="status"
        >
          <Loader2
            className="h-6 w-6 animate-spin text-primary"
            aria-hidden="true"
          />
          <p className="text-sm text-muted-foreground">Setting up your badge</p>
        </div>
      </div>
    );
  }

  if (!token) {
    return (
      <div className="flex flex-col gap-4">
        <h2 className="text-sm font-medium text-foreground">Badge preview</h2>
        <div className="rounded-xl border border-border bg-card p-12 flex flex-col items-center justify-center gap-3 min-h-[300px]">
          <AlertTriangle
            className="h-7 w-7 text-destructive"
            aria-hidden="true"
          />
          <div className="text-center">
            <p className="text-sm font-medium text-foreground">
              The badge did not generate
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              Pick the scan again to retry.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const { subdomain, host, path } = parseUrl(selected.url);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-foreground">Badge preview</h2>
        <div className="flex items-baseline gap-0 font-mono text-xs min-w-0 max-w-[60%]">
          {subdomain && (
            <span className="text-muted-foreground truncate max-w-[50px] shrink-0">
              {subdomain}.
            </span>
          )}
          <span className="text-foreground font-medium truncate shrink min-w-0">
            {host}
          </span>
          {path && (
            <span className="text-muted-foreground truncate max-w-[100px] shrink-0">
              {path}
            </span>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-8 flex items-center justify-center">
        <a
          href={shareUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="transition-transform hover:scale-105"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={badgeUrl} alt={`Secured by ${APP_NAME}`} />
        </a>
      </div>

      <a
        href={shareUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center justify-center gap-2 text-xs text-primary hover:underline underline-offset-4 rounded-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ExternalLink className="h-3 w-3" aria-hidden="true" />
        View full scan results
      </a>

      <ScopeToggle
        url={selected.url}
        scope={selected.site_badge_scope ?? "user"}
        onScopeChange={onScopeChange}
      />

      <div className="flex flex-col gap-3 pt-2">
        <SnippetBlock
          label="HTML"
          icon={Code2}
          code={htmlSnippet}
          copied={copiedField === "html"}
          onCopy={() => copyToClipboard(htmlSnippet, "html")}
        />
        <SnippetBlock
          label="Markdown"
          icon={Code2}
          code={markdownSnippet}
          copied={copiedField === "md"}
          onCopy={() => copyToClipboard(markdownSnippet, "md")}
        />
        <SnippetBlock
          label="Image URL"
          icon={ImageIcon}
          code={badgeUrl}
          copied={copiedField === "url"}
          onCopy={() => copyToClipboard(badgeUrl, "url")}
        />
      </div>
    </div>
  );
}
