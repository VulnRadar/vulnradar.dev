"use client";

import { useState } from "react";
import { Copy, Check, WrapText } from "lucide-react";
import { cn } from "@/lib/ui/utils";
import {
  CopiedAnnouncement,
  useCopyFeedback,
} from "@/components/shared/copy-feedback";

/** A shell prompt is for reading; pasting one runs a command called "$". */
export function stripShellPrompt(code: string): string {
  return code.replace(/^\$ /gm, "");
}

const captionButton = cn(
  "inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-background/80 px-2.5 py-1.5",
  "text-[11px] font-medium text-muted-foreground",
  "hover:bg-muted hover:text-foreground transition-colors",
  "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
);

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
  const { copied, copy } = useCopyFeedback();

  return (
    <>
      <button
        type="button"
        onClick={() => void copy(stripShellPrompt(text))}
        aria-label={copied ? `Copied ${label}` : `Copy ${label}`}
        className={cn(
          captionButton,
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
      <CopiedAnnouncement copied={copied} noun={label} />
    </>
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
  go: "Go",
  php: "PHP",
  java: "Java",
  ruby: "Ruby",
  csharp: "C#",
  nginx: "nginx",
  text: "text",
  env: ".env",
};

function languageLabel(language: string) {
  return LANGUAGE_LABELS[language] ?? language.toUpperCase();
}

const SHELL_CAPTIONS = {
  host: "On the host",
  container: "Inside the container",
} as const;

interface CodeBlockProps {
  code: string;
  language?: string;
  /** Path shown instead of the language chip, e.g. "lib/config/config-values.ts". */
  filename?: string;
  /** What the block is, e.g. "Request" or "201 Created". */
  title?: string;
  /** Where a command runs, for pages where both are in play. */
  shell?: keyof typeof SHELL_CAPTIONS;
  showCopy?: boolean;
  className?: string;
}

/**
 * A code block that scrolls inside itself rather than pushing the page
 * sideways, labels its language, and confirms a copy in words instead of
 * only a colour change. Wrap is for reading one long curl line on a phone
 * without the sideways scroll.
 *
 * The <pre> is focusable so a keyboard user can scroll a wide snippet
 * without a pointer, which is the only way to reach the right-hand side of
 * a long curl command at 375px.
 */
export function CodeBlock({
  code,
  language = "json",
  filename,
  title,
  shell,
  showCopy = true,
  className,
}: CodeBlockProps) {
  const [wrap, setWrap] = useState(false);
  const label = filename ?? languageLabel(language);

  return (
    <figure
      className={cn(
        // Full-strength --muted rather than a /30 wash. --muted sits 5% darker
        // than --background in light mode and 10% lighter in dark, so at full
        // opacity the block reads as a distinct surface in both; at /30 it was
        // roughly a 1.5% step and a snippet in the middle of prose did not
        // announce itself as one.
        //
        // Bleeds into the 16px gutter on a phone: 32px more code per line.
        "not-prose -mx-4 overflow-hidden rounded-none border border-x-0 border-border bg-muted/60 sm:mx-0 sm:rounded-lg sm:border-x",
        className,
      )}
    >
      <figcaption className="flex min-h-10 items-center justify-between gap-2 border-b border-border bg-muted px-3 py-1">
        <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2.5 text-muted-foreground">
          <span
            className={cn(
              filename
                ? // A filename is unbounded, so that one clips.
                  "min-w-0 truncate font-mono text-[11px]"
                : // The language is a label, not content: set as a tracked
                  // micro-caps chip so it never competes with the code itself.
                  // It is one of our own words ("BASH", "JSON"), so it does not
                  // truncate.
                  "font-mono text-[10px] font-semibold uppercase tracking-[0.12em]",
            )}
          >
            {label}
          </span>
          {title && (
            <span className="text-[11px] font-medium text-foreground">
              {title}
            </span>
          )}
          {shell && (
            <span className="text-[11px]">{SHELL_CAPTIONS[shell]}</span>
          )}
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={() => setWrap((value) => !value)}
            aria-pressed={wrap}
            aria-label={`Wrap long lines in the ${label} snippet`}
            className={cn(
              captionButton,
              wrap && "text-primary border-primary/40",
            )}
          >
            <WrapText className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Wrap</span>
          </button>
          {showCopy && <CopyButton text={code} label={`${label} snippet`} />}
        </span>
      </figcaption>
      <pre
        // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a scroll container has to take focus to be scrolled from the keyboard
        tabIndex={0}
        className={cn(
          "overflow-x-auto p-3 sm:p-4 font-mono text-[13px] leading-[1.6] text-foreground/90",
          "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
          wrap && "whitespace-pre-wrap wrap-break-word",
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

/**
 * Inline code was brand blue, and so is every link in docs prose. In a
 * paragraph that mentions `scanners` and links to the API reference in the
 * same sentence, the two were the same colour with no underline on either,
 * so the only way to tell a clickable thing from a literal was to point at
 * it. The chip already reads as code from the mono face and the tinted
 * background; --foreground makes it the more legible of the two as well.
 *
 * Sized in em rather than a fixed text-xs so it scales with whatever it sits
 * in: 12px was correct in a 14px paragraph and undersized in a heading.
 */
export function InlineCode({ children, className }: InlineCodeProps) {
  return (
    <code
      className={cn(
        "rounded-md bg-muted px-1.5 py-0.5 font-mono text-[0.875em] text-foreground wrap-break-word",
        className,
      )}
    >
      {children}
    </code>
  );
}
