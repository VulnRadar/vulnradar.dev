"use client";

import { useMemo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/ui/utils";
import { visibleText } from "@/lib/ai/think-parser";

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
  // Markdown headings are demoted two levels on purpose. The model writes
  // "# Heading" freely, and this renderer is mounted inside a widget that
  // floats over whatever page the reader is already on, so an h1 here would
  // inject a second (and third, and fourth) top-level heading into that
  // page's outline and break its document structure. h3 is the deepest level
  // any host page uses above the widget, so starting here keeps the reply
  // nested under it. All three render identically anyway (text-sm
  // font-semibold), so this is a semantics-only change.
  h1: ({ node: _node, children, ...props }) => (
    <h3 className="text-sm font-semibold mt-3 mb-1.5 first:mt-0" {...props}>
      {children}
    </h3>
  ),
  h2: ({ node: _node, children, ...props }) => (
    <h4 className="text-sm font-semibold mt-3 mb-1.5 first:mt-0" {...props}>
      {children}
    </h4>
  ),
  h3: ({ node: _node, children, ...props }) => (
    <h5 className="text-sm font-semibold mt-2.5 mb-1 first:mt-0" {...props}>
      {children}
    </h5>
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
  // Theme tokens, not bg-black/30. A fixed 30% black is a code slab on a
  // dark card and a mid-grey block on a light one, and the inherited body
  // colour then sat on it at whatever contrast happened to fall out: on the
  // light theme these were the two least readable elements in the widget.
  pre: ({ node: _node, ...props }) => (
    <pre
      className="bg-muted/60 text-foreground border border-border/60 rounded-md p-2.5 my-2 text-xs sm:text-[11px] font-mono overflow-x-auto whitespace-pre"
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
    // wrap-break-word (overflow-wrap: break-word), never break-all. break-all
    // takes a break opportunity at any character, so it split short commands
    // to fill the line above them: the greeting's `/changelog` chip rendered
    // as "/cha" at one line's end and "ngelog" at the next line's start, which
    // is unreadable and cannot be copied. overflow-wrap: break-word only
    // breaks a token that will not fit on a line *by itself*, so a command, a
    // header name or a config key moves down whole and only something genuinely
    // wider than the bubble is ever cut.
    return (
      <code
        className="bg-background text-foreground px-1 py-0.5 rounded-md text-[0.82em] font-mono border border-border/60 wrap-break-word"
        {...props}
      >
        {children}
      </code>
    );
  },
  // Same rule on links: the widget is a ~260px-wide bubble on a phone and the
  // model routinely emits a bare documentation URL as one unbroken token.
  // Without a break rule that token sets the bubble's min width and the whole
  // chat panel scrolls sideways.
  a: ({ node: _node, children, ...props }) => (
    <a
      className="wrap-break-word text-primary underline underline-offset-2 hover:text-primary/80"
      target="_blank"
      rel="noopener noreferrer"
      {...props}
    >
      {children}
    </a>
  ),
  blockquote: ({ node: _node, ...props }) => (
    <blockquote
      className="border-l-2 border-primary/30 pl-3 my-1.5 text-muted-foreground/80"
      {...props}
    />
  ),
  // A table cell will not shrink below its own min-content width, so w-full
  // alone does not hold a three-column comparison table inside a phone-width
  // bubble: it pushed the panel sideways instead. The scroller is the same
  // shape components/ui/table.tsx and DocsTable already use.
  table: ({ node: _node, ...props }) => (
    <div className="my-2 overflow-x-auto">
      <table
        className="text-xs sm:text-[11px] border-collapse w-full"
        {...props}
      />
    </div>
  ),
  // scope="col" (SC 1.3.1): markdown tables from the assistant only ever have
  // a header row, and without scope the header cells are not linked to the
  // data under them.
  th: ({ node: _node, ...props }) => (
    <th
      scope="col"
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
  // Never rendered. A markdown image is a request from the reader's browser to
  // whatever URL the model wrote, and the model writes what a scanned page or a
  // pasted payload told it to: an image is how that leaks the conversation.
  img: () => null,
};

export function MarkdownContent({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={messageMarkdownComponents}
    >
      {content}
    </ReactMarkdown>
  );
}

/**
 * Renders one stored message: markdown for the assistant, plain text for the
 * user. Shared by the live chat widget and the admin AI-chat viewer so the two
 * cannot drift apart. Reasoning saved in older conversations is dropped here
 * (visibleText): nobody reads it, staff included, because it was never the
 * answer and often argued its way to a different one.
 */
export function MessageContent({
  content,
  role,
}: {
  content: string;
  role: "user" | "assistant";
}) {
  const answer = useMemo(
    () => (role === "user" ? content : visibleText(content)),
    [content, role],
  );

  if (role === "user") {
    return <span className="whitespace-pre-wrap">{content}</span>;
  }

  return <MarkdownContent content={answer} />;
}
