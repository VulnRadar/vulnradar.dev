"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Copy, Check } from "lucide-react";
import { cn } from "@/lib/ui/utils";

/**
 * Copy state lives in one hook so the button and the block agree on the
 * confirmation window, and so the timer is cleared if the component
 * unmounts mid-confirmation.
 */
function useCopy(text: string) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Clipboard write failed:", err);
    }
  }, [text]);

  return { copied, copy };
}

interface CopyButtonProps {
  text: string;
  /** Names what is being copied, for screen readers. */
  label?: string;
  className?: string;
}

export function CopyButton({
  text,
  label = "code",
  className,
}: CopyButtonProps) {
  const { copied, copy } = useCopy(text);

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={copied ? `Copied ${label}` : `Copy ${label}`}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-background/80 px-2 py-1",
        "text-[11px] font-medium text-muted-foreground",
        "hover:bg-muted hover:text-foreground transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        copied && "text-primary border-primary/40",
        className,
      )}
    >
      {copied ? (
        <Check className="h-3.5 w-3.5" aria-hidden="true" />
      ) : (
        <Copy className="h-3.5 w-3.5" aria-hidden="true" />
      )}
      <span>{copied ? "Copied" : "Copy"}</span>
    </button>
  );
}

// Display names for the language chip. Anything not listed is uppercased,
// which is right for the long tail (yaml, toml, ini, sql).
const LANGUAGE_LABELS: Record<string, string> = {
  bash: "bash",
  sh: "shell",
  shell: "shell",
  http: "HTTP",
  json: "JSON",
  javascript: "JavaScript",
  js: "JavaScript",
  typescript: "TypeScript",
  ts: "TypeScript",
  tsx: "TSX",
  python: "Python",
  nginx: "nginx",
  text: "text",
  env: ".env",
};

function languageLabel(language: string) {
  return LANGUAGE_LABELS[language] ?? language.toUpperCase();
}

interface CodeBlockProps {
  code: string;
  language?: string;
  /** Path shown instead of the language chip, e.g. "lib/config/config-values.ts". */
  filename?: string;
  showCopy?: boolean;
  className?: string;
}

/**
 * A code block that scrolls inside itself rather than pushing the page
 * sideways, labels its language, and confirms a copy in words instead of
 * only a colour change.
 *
 * The <pre> is focusable so a keyboard user can scroll a wide snippet
 * without a pointer, which is the only way to reach the right-hand side of
 * a long curl command at 375px.
 */
export function CodeBlock({
  code,
  language = "json",
  filename,
  showCopy = true,
  className,
}: CodeBlockProps) {
  const label = filename ?? languageLabel(language);

  return (
    <figure
      className={cn(
        "not-prose overflow-hidden rounded-lg border border-border/60 bg-muted/30",
        className,
      )}
    >
      <figcaption className="flex items-center justify-between gap-2 border-b border-border/60 bg-muted/50 px-3 py-1.5">
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-[11px] text-muted-foreground",
            filename ? "font-mono" : "font-medium",
          )}
        >
          {label}
        </span>
        {showCopy && (
          <CopyButton
            text={code}
            label={`${label} snippet`}
            className="flex-shrink-0"
          />
        )}
      </figcaption>
      <pre
        tabIndex={0}
        className={cn(
          "overflow-x-auto p-3 sm:p-4 text-xs sm:text-[13px] leading-relaxed font-mono text-foreground/90",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        )}
      >
        <code className={`language-${language}`}>{code}</code>
      </pre>
    </figure>
  );
}

interface InlineCodeProps {
  children: React.ReactNode;
  className?: string;
}

export function InlineCode({ children, className }: InlineCodeProps) {
  return (
    <code
      className={cn(
        "bg-muted px-1.5 py-0.5 rounded text-xs font-mono text-primary break-words",
        className,
      )}
    >
      {children}
    </code>
  );
}
