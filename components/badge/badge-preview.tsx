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
import { API, APP_NAME } from "@/lib/config/client-constants";
import { cn } from "@/lib/ui/utils";
import { copyToClipboard as copyTextToClipboard } from "@/lib/ui/clipboard";
import { UrlDisplay } from "@/components/shared/url-display";
import type { ScanEntry } from "./badge-types";

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

/**
 * One frame for every state of this column. The empty, generating, failed and
 * loaded states each used to carry their own copy of the "Badge preview"
 * heading and the box classes, four copies that had already drifted: the
 * failure looked exactly like the spinner apart from the glyph. The tone here
 * is what tells them apart.
 */
function PreviewFrame({
  title,
  headerRight,
  tone = "default",
  bodyClassName,
  bodyRole,
  children,
}: {
  title: string;
  headerRight?: React.ReactNode;
  tone?: "default" | "empty" | "error";
  bodyClassName?: string;
  bodyRole?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-foreground">{title}</h2>
        {headerRight}
      </div>
      <div
        role={bodyRole}
        className={cn(
          "rounded-xl border",
          tone === "empty" && "border-dashed border-border bg-card/50",
          tone === "error" && "border-destructive/40 bg-destructive/5",
          tone === "default" && "border-border bg-card",
          bodyClassName,
        )}
      >
        {children}
      </div>
    </div>
  );
}

const PLACEHOLDER_BODY =
  "p-12 flex flex-col items-center justify-center gap-3 min-h-[300px]";

/** A row inside the embed panel. Not a card of its own: three free-standing
 *  cards with identical chrome was the same snippet drawn three times. */
function SnippetRow({
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
    <div className="flex items-start gap-3 px-3 py-2.5">
      <span className="flex w-[86px] shrink-0 items-center gap-1.5 pt-1 text-xs font-medium text-muted-foreground">
        <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
        {label}
      </span>
      <pre className="min-w-0 flex-1 overflow-x-auto pt-1">
        <code className="text-xs font-mono text-foreground/80 whitespace-pre-wrap break-all">
          {code}
        </code>
      </pre>
      <Button
        variant="ghost"
        size="sm"
        onClick={onCopy}
        aria-label={copied ? `${label} copied` : `Copy the ${label} snippet`}
        className="h-8 shrink-0 px-2 gap-1 text-xs"
      >
        {copied ? (
          <>
            <Check
              className="h-3 w-3 text-[hsl(var(--success))]"
              aria-hidden="true"
            />
            Copied
          </>
        ) : (
          <>
            <Copy className="h-3 w-3" aria-hidden="true" />
            Copy
          </>
        )}
      </Button>
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
      <PreviewFrame
        title="Badge preview"
        tone="empty"
        bodyClassName={PLACEHOLDER_BODY}
      >
        <ImageIcon
          className="h-7 w-7 text-muted-foreground/50"
          aria-hidden="true"
        />
        <p className="text-sm text-muted-foreground text-center">
          Pick a scan on the left to preview its badge
        </p>
      </PreviewFrame>
    );
  }

  if (generating) {
    return (
      <PreviewFrame
        title="Badge preview"
        bodyClassName={PLACEHOLDER_BODY}
        bodyRole="status"
      >
        <Loader2
          className="h-6 w-6 animate-spin text-primary"
          aria-hidden="true"
        />
        <p className="text-sm text-muted-foreground">Setting up your badge</p>
      </PreviewFrame>
    );
  }

  if (!token) {
    return (
      <PreviewFrame
        title="Badge preview"
        tone="error"
        bodyClassName={PLACEHOLDER_BODY}
      >
        <AlertTriangle
          className="h-7 w-7 text-destructive"
          aria-hidden="true"
        />
        <div className="text-center">
          <p className="text-sm font-medium text-foreground">
            The badge did not generate
          </p>
          <p className="text-sm text-muted-foreground mt-1">
            Pick the scan again on the left to retry.
          </p>
        </div>
      </PreviewFrame>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <PreviewFrame
        title="Badge preview"
        bodyClassName="p-8 flex items-center justify-center"
        headerRight={<UrlDisplay url={selected.url} className="max-w-[60%]" />}
      >
        <a
          href={shareUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="transition-transform hover:scale-105"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={badgeUrl} alt={`Secured by ${APP_NAME}`} />
        </a>
      </PreviewFrame>

      {/* The snippets are what people came here to copy, so they sit directly
          under the preview. They used to render last, below the scan link and
          the scope toggle, which put the page's whole point off the fold. */}
      <div className="flex flex-col gap-4">
        <h2 className="text-sm font-medium text-foreground">Embed code</h2>
        <div className="rounded-xl border border-border bg-muted/30 divide-y divide-border">
          <SnippetRow
            label="HTML"
            icon={Code2}
            code={htmlSnippet}
            copied={copiedField === "html"}
            onCopy={() => copyToClipboard(htmlSnippet, "html")}
          />
          <SnippetRow
            label="Markdown"
            icon={Code2}
            code={markdownSnippet}
            copied={copiedField === "md"}
            onCopy={() => copyToClipboard(markdownSnippet, "md")}
          />
          <SnippetRow
            label="Image URL"
            icon={ImageIcon}
            code={badgeUrl}
            copied={copiedField === "url"}
            onCopy={() => copyToClipboard(badgeUrl, "url")}
          />
        </div>
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
    </div>
  );
}
