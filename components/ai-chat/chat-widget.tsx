"use client";

import {
  useRef,
  useEffect,
  useState,
  useCallback,
  useMemo,
  FormEvent,
  KeyboardEvent,
} from "react";
import {
  MessageCircle,
  X,
  Send,
  Loader2,
  Trash2,
  ChevronDown,
  Copy,
  Check,
  ExternalLink,
} from "lucide-react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/ui/utils";
import { useAuth } from "@/components/providers/auth-provider";
import {
  APP_NAME,
  AI_CHAT_HISTORY_DAYS,
  AI_CHAT_MAX_INPUT_LENGTH,
} from "@/lib/config/constants";
import { parseSegments } from "@/lib/ai/think-parser";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

type ModelInfo = {
  name: string;
  provider: string;
  url: string;
};

const STORAGE_KEY = "vulnradar_ai_chat_v1";
const MAX_AGE_MS = AI_CHAT_HISTORY_DAYS * 24 * 60 * 60 * 1000;

const WELCOME: ChatMessage = {
  id: "welcome",
  role: "assistant",
  content: `Ask me about scan findings, how to fix specific issues, API usage, or self-hosting ${APP_NAME}.`,
};

function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function loadHistory(): ChatMessage[] {
  if (typeof window === "undefined") return [WELCOME];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [WELCOME];
    const parsed = JSON.parse(raw) as {
      messages: ChatMessage[];
      savedAt: number;
    };
    if (Date.now() - parsed.savedAt > MAX_AGE_MS) {
      localStorage.removeItem(STORAGE_KEY);
      return [WELCOME];
    }
    return parsed.messages.length > 0 ? parsed.messages : [WELCOME];
  } catch {
    return [WELCOME];
  }
}

function saveHistory(messages: ChatMessage[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ messages, savedAt: Date.now() }),
    );
  } catch {
    // quota exceeded or private mode
  }
}

const mdComponents: Components = {
  p: ({ node: _node, ...props }) => (
    <p className="mb-2 last:mb-0 leading-relaxed" {...props} />
  ),
  h1: ({ node: _node, ...props }) => (
    <h1 className="text-base font-semibold mt-3 mb-1.5 first:mt-0" {...props} />
  ),
  h2: ({ node: _node, ...props }) => (
    <h2 className="text-base font-semibold mt-3 mb-1.5 first:mt-0" {...props} />
  ),
  h3: ({ node: _node, ...props }) => (
    <h3 className="text-sm font-semibold mt-2.5 mb-1 first:mt-0" {...props} />
  ),
  h4: ({ node: _node, ...props }) => (
    <h4 className="text-sm font-semibold mt-2 mb-1 first:mt-0" {...props} />
  ),
  ul: ({ node: _node, ...props }) => (
    <ul className="list-disc pl-5 my-1.5 space-y-0.5" {...props} />
  ),
  ol: ({ node: _node, ...props }) => (
    <ol className="list-decimal pl-5 my-1.5 space-y-0.5" {...props} />
  ),
  li: ({ node: _node, ...props }) => (
    <li className="leading-relaxed" {...props} />
  ),
  pre: ({ node: _node, ...props }) => (
    <pre
      className="bg-background/70 border border-border/40 rounded p-2 my-2 text-xs font-mono overflow-x-auto whitespace-pre"
      {...props}
    />
  ),
  code: ({ className, children, ...props }) => {
    const isBlock = /language-/.test(className || "");
    if (isBlock) {
      return (
        <code className={cn("font-mono", className)} {...props}>
          {children}
        </code>
      );
    }
    return (
      <code
        className="bg-background/60 px-1 py-0.5 rounded text-[0.85em] font-mono"
        {...props}
      >
        {children}
      </code>
    );
  },
  a: ({ node: _node, ...props }) => (
    <a
      className="text-primary underline underline-offset-2"
      target="_blank"
      rel="noopener noreferrer"
      {...props}
    />
  ),
  blockquote: ({ node: _node, ...props }) => (
    <blockquote
      className="border-l-2 border-border pl-3 my-1.5 text-muted-foreground"
      {...props}
    />
  ),
  table: ({ node: _node, ...props }) => (
    <table className="text-xs my-2 border-collapse w-full" {...props} />
  ),
  th: ({ node: _node, ...props }) => (
    <th
      className="border border-border/40 px-2 py-1 text-left font-semibold bg-muted/40"
      {...props}
    />
  ),
  td: ({ node: _node, ...props }) => (
    <td className="border border-border/40 px-2 py-1 align-top" {...props} />
  ),
  strong: ({ node: _node, ...props }) => (
    <strong className="font-semibold" {...props} />
  ),
  em: ({ node: _node, ...props }) => <em className="italic" {...props} />,
  hr: ({ node: _node, ...props }) => (
    <hr className="border-border/40 my-2" {...props} />
  ),
};

function MarkdownContent({ content }: { content: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
      {content}
    </ReactMarkdown>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
      } finally {
        document.body.removeChild(ta);
      }
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }, [text]);

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="absolute top-1 right-1 h-6 w-6 p-0 flex items-center justify-center rounded-md text-muted-foreground/60 hover:text-foreground hover:bg-background/40 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity touch-manipulation"
      title={copied ? "Copied" : "Copy message"}
      aria-label={copied ? "Copied to clipboard" : "Copy message"}
    >
      {copied ? (
        <Check className="h-3 w-3 text-emerald-500" />
      ) : (
        <Copy className="h-3 w-3" />
      )}
    </button>
  );
}

function ThinkBlock({ content }: { content: string }) {
  return (
    <details className="group/thk mb-2">
      <summary className="flex items-center gap-1.5 cursor-pointer text-[11px] text-muted-foreground/60 hover:text-muted-foreground transition-colors list-none [&::-webkit-details-marker]:hidden [&::marker]:hidden">
        <ChevronDown className="h-3 w-3 transition-transform duration-150 group-open/thk:rotate-180" />
        <span>View reasoning</span>
      </summary>
      <div className="mt-1.5 pl-3 border-l-2 border-border/40 text-[11px] text-muted-foreground/60 leading-relaxed whitespace-pre-wrap">
        {content}
      </div>
    </details>
  );
}

function MessageBubble({
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

  const isUser = role === "user";

  return (
    <div
      className={cn(
        "group relative rounded-lg px-3 py-2 text-sm leading-relaxed max-w-[85%] break-words",
        isUser
          ? "whitespace-pre-wrap bg-primary text-primary-foreground"
          : "bg-muted text-foreground",
      )}
    >
      {isUser
        ? content
        : segments.map((seg, i) =>
            seg.type === "think" ? (
              <ThinkBlock key={i} content={seg.content} />
            ) : (
              <MarkdownContent key={i} content={seg.content} />
            ),
          )}
      <CopyButton text={content} />
    </div>
  );
}

function UserAvatar({ src, name }: { src?: string | null; name: string }) {
  if (src) {
    return (
      <img
        src={src}
        alt={name}
        className="h-6 w-6 rounded-full object-cover shrink-0"
      />
    );
  }
  const initials = name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <div className="h-6 w-6 rounded-full bg-muted border border-border/60 flex items-center justify-center text-[10px] font-bold text-muted-foreground shrink-0">
      {initials || "?"}
    </div>
  );
}

function AiAvatar() {
  return (
    <img
      src="/favicon.svg"
      alt={`${APP_NAME} AI`}
      className="h-6 w-6 rounded-full shrink-0"
    />
  );
}

function PanelFooter({ model }: { model: ModelInfo | null }) {
  return (
    <div className="px-3 py-1.5 border-t border-border/40 bg-muted/10 text-[10px] leading-snug text-muted-foreground/70 shrink-0">
      <div className="flex items-center gap-1.5 flex-wrap">
        <span>
          AI can be wrong. Responses are generated by a third-party model, not
          by {APP_NAME}.
        </span>
        {model ? (
          <a
            href={model.url || "#"}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-primary/80 hover:text-primary"
          >
            Powered by {model.provider}
            <ExternalLink className="h-2.5 w-2.5" />
          </a>
        ) : (
          <span>Powered by your configured AI provider.</span>
        )}
      </div>
    </div>
  );
}

export function ChatWidget() {
  const { me } = useAuth();
  const isLoggedIn = !!me?.userId;
  const userName = me?.name || "Guest";
  const userAvatar = me?.avatarUrl ?? null;

  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>(() => loadHistory());
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [model, setModel] = useState<ModelInfo | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    saveHistory(messages);
  }, [messages]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    if (!isOpen) return;
    setTimeout(() => inputRef.current?.focus(), 60);

    const orig = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const vv = window.visualViewport;
    const onResize = () => {
      if (!vv) return;
      const root = document.documentElement;
      root.style.setProperty(
        "--ai-chat-keyboard",
        `${Math.max(0, window.innerHeight - vv.height)}px`,
      );
    };
    vv?.addEventListener("resize", onResize);
    onResize();

    return () => {
      document.body.style.overflow = orig;
      vv?.removeEventListener("resize", onResize);
      document.documentElement.style.removeProperty("--ai-chat-keyboard");
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      const t = e.target as Node | null;
      if (panelRef.current && t && !panelRef.current.contains(t)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [isOpen]);

  const clearChat = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setMessages([WELCOME]);
  }, []);

  const atLimit = input.length >= AI_CHAT_MAX_INPUT_LENGTH;
  const overLimit = input.length > AI_CHAT_MAX_INPUT_LENGTH;
  const canSend = input.trim().length > 0 && !isStreaming && !overLimit;

  const autoResize = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
  }, []);

  useEffect(() => {
    autoResize();
  }, [input, autoResize]);

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (canSend) handleSubmit(e);
    }
  }

  async function handleSubmit(
    e: FormEvent<HTMLFormElement> | KeyboardEvent<HTMLTextAreaElement>,
  ) {
    e.preventDefault();
    if (!canSend) return;

    const userMsg: ChatMessage = {
      id: uid(),
      role: "user",
      content: input.trim(),
    };
    const aiMsgId = uid();

    setMessages((prev) => [
      ...prev,
      userMsg,
      { id: aiMsgId, role: "assistant", content: "" },
    ]);
    setInput("");
    autoResize();
    setIsStreaming(true);

    try {
      const history = [...messages, userMsg];
      const res = await fetch("/api/v3/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userName,
          messages: history.map((m) => ({ role: m.role, content: m.content })),
        }),
      });

      const h = res.headers;
      setModel({
        name: h.get("X-AI-Model") || "",
        provider: h.get("X-AI-Provider-Name") || "",
        url: h.get("X-AI-Provider-Url") || "",
      });

      if (!res.ok) {
        const err = await res
          .json()
          .catch(() => ({ error: "Request failed." }));
        setMessages((prev) =>
          prev.map((m) =>
            m.id === aiMsgId
              ? { ...m, content: err.error || "Request failed." }
              : m,
          ),
        );
        return;
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          setMessages((prev) =>
            prev.map((m) =>
              m.id === aiMsgId ? { ...m, content: m.content + chunk } : m,
            ),
          );
        }
      }
    } catch {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === aiMsgId
            ? { ...m, content: "Something went wrong. Please try again." }
            : m,
        ),
      );
    } finally {
      setIsStreaming(false);
    }
  }

  return (
    <>
      {isOpen && (
        <div
          ref={panelRef}
          className={cn(
            "fixed inset-0 sm:inset-x-auto sm:right-6 sm:bottom-6 z-50",
            "w-full sm:w-[420px] md:w-[460px] sm:max-w-[calc(100vw-3rem)]",
            "h-[100dvh] sm:h-auto sm:max-h-[min(640px,calc(100dvh-4rem))] flex flex-col",
            "bg-card sm:rounded-xl sm:border sm:border-border/60 sm:shadow-2xl sm:shadow-black/40",
            "overflow-hidden",
          )}
          role="dialog"
          aria-label={`${APP_NAME} AI assistant`}
        >
          {/* Header */}
          <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-border/50 bg-muted/20 shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              <AiAvatar />
              <div className="min-w-0">
                <p className="text-sm font-semibold leading-none">
                  {APP_NAME} AI
                </p>
                <p className="text-[10px] text-muted-foreground mt-0.5 leading-none">
                  {isLoggedIn ? `Signed in as ${userName}` : "Not signed in"}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <Button
                variant="ghost"
                size="sm"
                onClick={clearChat}
                className="h-11 w-11 p-0 text-muted-foreground hover:text-foreground touch-manipulation"
                title="Clear chat history"
                aria-label="Clear chat history"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsOpen(false)}
                className="h-11 w-11 p-0 text-muted-foreground hover:text-foreground touch-manipulation"
                aria-label="Close chat"
              >
                <X className="h-5 w-5" />
              </Button>
            </div>
          </div>

          {/* Messages */}
          <div
            ref={scrollRef}
            className="flex-1 overflow-y-auto overscroll-contain px-3 py-3 space-y-4 min-h-0"
          >
            {messages.map((m) => (
              <div
                key={m.id}
                className={cn(
                  "flex gap-2",
                  m.role === "user" ? "flex-row-reverse" : "flex-row",
                )}
              >
                {m.role === "user" ? (
                  <UserAvatar
                    src={isLoggedIn ? userAvatar : null}
                    name={isLoggedIn ? userName : "Guest"}
                  />
                ) : (
                  <AiAvatar />
                )}

                {m.content === "" && m.role === "assistant" ? (
                  <div
                    key={`${m.id}-thinking`}
                    aria-live="polite"
                    aria-label="Assistant is thinking"
                    className="rounded-lg px-3 py-2 bg-muted motion-safe:animate-pulse"
                  >
                    <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground/80 font-medium">
                      <span>Thinking</span>
                      <span className="flex gap-1">
                        <span
                          className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60 motion-safe:animate-pulse"
                          style={{ animationDelay: "0ms" }}
                        />
                        <span
                          className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60 motion-safe:animate-pulse"
                          style={{ animationDelay: "150ms" }}
                        />
                        <span
                          className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60 motion-safe:animate-pulse"
                          style={{ animationDelay: "300ms" }}
                        />
                      </span>
                    </div>
                  </div>
                ) : (
                  <MessageBubble content={m.content} role={m.role} />
                )}
              </div>
            ))}
          </div>

          {/* Input */}
          <form
            onSubmit={handleSubmit}
            className="px-3 pt-2 border-t border-border/50 bg-background/50 shrink-0"
            style={{
              paddingBottom:
                "calc(0.5rem + env(safe-area-inset-bottom) + var(--ai-chat-keyboard, 0px))",
            }}
          >
            <div className="flex items-end gap-2">
              <UserAvatar
                src={isLoggedIn ? userAvatar : null}
                name={isLoggedIn ? userName : "Guest"}
              />
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => {
                  setInput(e.target.value.slice(0, AI_CHAT_MAX_INPUT_LENGTH));
                  autoResize();
                }}
                onKeyDown={handleKeyDown}
                placeholder={
                  isLoggedIn
                    ? `Message as ${userName}... (Enter to send, Shift+Enter for new line)`
                    : "Ask a question... (Enter to send, Shift+Enter for new line)"
                }
                disabled={isStreaming}
                maxLength={AI_CHAT_MAX_INPUT_LENGTH}
                rows={1}
                style={{
                  touchAction: "manipulation",
                  minHeight: "calc(1.5em * 3 + 1rem)",
                }}
                className="flex-1 text-base sm:text-sm bg-transparent outline-none placeholder:text-muted-foreground/40 disabled:opacity-50 py-2 px-2 rounded-md border border-border/40 focus:border-primary/60 resize-none overflow-y-auto leading-snug"
                autoComplete="off"
              />
              <Button
                type="submit"
                variant="ghost"
                size="sm"
                disabled={!canSend}
                className="h-11 w-11 p-0 shrink-0 text-muted-foreground hover:text-foreground touch-manipulation disabled:opacity-40"
                aria-label="Send"
              >
                {isStreaming ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </Button>
            </div>
            <div
              className={cn(
                "mt-1 text-[10px] tabular-nums text-right transition-colors",
                atLimit
                  ? "text-red-500"
                  : input.length > AI_CHAT_MAX_INPUT_LENGTH * 0.8
                    ? "text-amber-500"
                    : "text-muted-foreground/50",
              )}
            >
              {input.length} / {AI_CHAT_MAX_INPUT_LENGTH}
            </div>
          </form>

          {/* Footer: AI disclaimer + Powered by */}
          <PanelFooter model={model} />
        </div>
      )}

      {/* Floating trigger - hidden when panel is open to avoid overlap with the panel X button */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className={cn(
            "fixed bottom-4 right-4 sm:right-6 z-50",
            "h-14 w-14 sm:h-12 sm:w-12 rounded-full flex items-center justify-center",
            "border shadow-lg shadow-black/20",
            "transition-all duration-150 active:scale-95 touch-manipulation",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
            "pb-[env(safe-area-inset-bottom)]",
            "bg-primary/10 border-primary/30 text-primary hover:bg-primary/20 hover:border-primary/60",
          )}
          aria-label="Open AI assistant"
        >
          <MessageCircle className="h-5 w-5" />
        </button>
      )}
    </>
  );
}
