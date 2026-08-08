"use client";

import { useMemo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/ui/utils";
import { parseSegments } from "@/lib/ai/think-parser";

/**
 * The exact react-markdown component overrides the live chat widget
 * (components/ai-chat/chat-widget.tsx) uses. Kept here, alongside
 * `MessageContent`, so any renderer of a stored AI message produces
 * identical output to the widget: today that's the widget's own inline
 * copy and the admin conversation viewer, both rendering from this same
 * pipeline. If chat-widget.tsx's copy of these ever changes, this is the
 * one to keep in sync with it (or, better, the one it should import from).
 */
export const messageMarkdownComponents: Components = {
  p: ({ node: _node, ...props }) => (
    <p className="mb-2 last:mb-0 leading-relaxed" {...props} />
  ),
  h1: ({ node: _node, ...props }) => (
    <h1 className="text-sm font-semibold mt-3 mb-1.5 first:mt-0" {...props} />
  ),
  h2: ({ node: _node, ...props }) => (
    <h2 className="text-sm font-semibold mt-3 mb-1.5 first:mt-0" {...props} />
  ),
  h3: ({ node: _node, ...props }) => (
    <h3 className="text-sm font-semibold mt-2.5 mb-1 first:mt-0" {...props} />
  ),
  ul: ({ node: _node, ...props }) => (
    <ul className="list-disc pl-4 my-1.5 space-y-0.5" {...props} />
  ),
  ol: ({ node: _node, ...props }) => (
    <ol className="list-decimal pl-4 my-1.5 space-y-0.5" {...props} />
  ),
  li: ({ node: _node, ...props }) => (
    <li className="leading-relaxed" {...props} />
  ),
  pre: ({ node: _node, ...props }) => (
    <pre
      className="bg-black/30 border border-border/30 rounded-md p-2.5 my-2 text-[11px] font-mono overflow-x-auto whitespace-pre"
      {...props}
    />
  ),
  code: ({ className, children, ...props }) => {
    const isBlock = /language-/.test(className || "");
    if (isBlock) {
      return (
        <code className={cn("font-mono text-[11px]", className)} {...props}>
          {children}
        </code>
      );
    }
    return (
      <code
        className="bg-black/30 px-1 py-0.5 rounded text-[0.82em] font-mono border border-border/20"
        {...props}
      >
        {children}
      </code>
    );
  },
  a: ({ node: _node, ...props }) => (
    <a
      className="text-primary underline underline-offset-2 hover:text-primary/80"
      target="_blank"
      rel="noopener noreferrer"
      {...props}
    />
  ),
  blockquote: ({ node: _node, ...props }) => (
    <blockquote
      className="border-l-2 border-primary/30 pl-3 my-1.5 text-muted-foreground/80"
      {...props}
    />
  ),
  table: ({ node: _node, ...props }) => (
    <table className="text-[11px] my-2 border-collapse w-full" {...props} />
  ),
  th: ({ node: _node, ...props }) => (
    <th
      className="border border-border/40 px-2 py-1 text-left font-semibold bg-muted/30"
      {...props}
    />
  ),
  td: ({ node: _node, ...props }) => (
    <td className="border border-border/40 px-2 py-1 align-top" {...props} />
  ),
  strong: ({ node: _node, ...props }) => (
    <strong className="font-semibold text-foreground" {...props} />
  ),
  em: ({ node: _node, ...props }) => <em className="italic" {...props} />,
  hr: ({ node: _node, ...props }) => (
    <hr className="border-border/30 my-2" {...props} />
  ),
};

export function MarkdownContent({ content }: { content: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={messageMarkdownComponents}>
      {content}
    </ReactMarkdown>
  );
}

export function ThinkBlock({ content }: { content: string }) {
  return (
    <details className="group/thk mb-2">
      <summary className="flex items-center gap-1.5 cursor-pointer text-[10px] text-muted-foreground/50 hover:text-muted-foreground/70 transition-colors list-none [&::-webkit-details-marker]:hidden [&::marker]:hidden select-none">
        <ChevronDown className="h-2.5 w-2.5 transition-transform duration-150 group-open/thk:rotate-180" />
        <span className="font-mono">View reasoning</span>
      </summary>
      <div className="mt-1.5 pl-3 border-l border-border/40 text-[10px] text-muted-foreground/50 leading-relaxed whitespace-pre-wrap font-mono">
        {content}
      </div>
    </details>
  );
}

/**
 * Renders one stored message's content: for the assistant role, this parses
 * <think>...</think> segments via lib/ai/think-parser's parseSegments and
 * renders each as either a collapsed reasoning block or real markdown; for
 * the user role, it renders plain text. This is the single rendering path
 * meant to be shared by the live chat widget and the admin AI-chat viewer,
 * so the two can never drift into two different-looking renderers, and a
 * raw, unparsed `<think>` tag never reaches an admin's screen.
 */
export function MessageContent({
  content,
  role,
}: {
  content: string;
  role: "user" | "assistant";
}) {
  const segments = useMemo(
    () => (role === "user" ? [] : parseSegments(content)),
    [content, role],
  );

  if (role === "user") {
    return <span className="whitespace-pre-wrap">{content}</span>;
  }

  return (
    <>
      {segments.map((seg, i) =>
        seg.type === "think" ? (
          <ThinkBlock key={i} content={seg.content} />
        ) : (
          <MarkdownContent key={i} content={seg.content} />
        ),
      )}
    </>
  );
}
