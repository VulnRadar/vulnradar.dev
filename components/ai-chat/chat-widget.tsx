"use client";

import { useRef, useEffect, useState, useCallback, FormEvent } from "react";
import {
  MessageCircle,
  X,
  Send,
  Loader2,
  Trash2,
  ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/ui/utils";
import { useAuth } from "@/components/providers/auth-provider";
import { APP_NAME, AI_CHAT_HISTORY_DAYS } from "@/lib/config/constants";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
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

// ── Think block parser ────────────────────────────────────────────────────────
// Splits content into alternating normal/think segments.
// e.g. "<think>reasoning</think>Answer" → [think, normal]
type Segment = { type: "text" | "think"; content: string };

function parseSegments(raw: string): Segment[] {
  const segments: Segment[] = [];
  const re = /<think>([\s\S]*?)<\/think>/gi;
  let last = 0;
  let match: RegExpExecArray | null;

  while ((match = re.exec(raw)) !== null) {
    if (match.index > last) {
      const before = raw.slice(last, match.index).trim();
      if (before) segments.push({ type: "text", content: before });
    }
    const thinking = match[1].trim();
    if (thinking) segments.push({ type: "think", content: thinking });
    last = match.index + match[0].length;
  }

  const after = raw.slice(last).trim();
  if (after) segments.push({ type: "text", content: after });

  // If no segments parsed (no think tags), return original as text
  if (segments.length === 0 && raw.trim()) {
    return [{ type: "text", content: raw.trim() }];
  }
  return segments;
}

function ThinkBlock({ content }: { content: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-2">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-[11px] text-muted-foreground/60 hover:text-muted-foreground transition-colors"
      >
        <ChevronDown
          className={cn(
            "h-3 w-3 transition-transform duration-150",
            open && "rotate-180",
          )}
        />
        {open ? "Hide reasoning" : "View reasoning"}
      </button>
      {open && (
        <div className="mt-1.5 pl-3 border-l-2 border-border/40 text-[11px] text-muted-foreground/60 leading-relaxed whitespace-pre-wrap">
          {content}
        </div>
      )}
    </div>
  );
}

function MessageBubble({
  content,
  role,
}: {
  content: string;
  role: "user" | "assistant";
}) {
  if (role === "user") {
    return (
      <div className="rounded-lg px-3 py-2 text-sm leading-relaxed max-w-[80%] whitespace-pre-wrap break-words bg-primary text-primary-foreground">
        {content}
      </div>
    );
  }

  const segments = parseSegments(content);

  return (
    <div className="rounded-lg px-3 py-2 text-sm leading-relaxed max-w-[80%] break-words bg-muted text-foreground">
      {segments.map((seg, i) =>
        seg.type === "think" ? (
          <ThinkBlock key={i} content={seg.content} />
        ) : (
          <span key={i} className="whitespace-pre-wrap">
            {seg.content}
          </span>
        ),
      )}
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

export function ChatWidget() {
  const { me } = useAuth();
  const isLoggedIn = !!me?.userId;
  const userName = me?.name || "Guest";
  const userAvatar = me?.avatarUrl ?? null;

  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>(() => loadHistory());
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    saveHistory(messages);
  }, [messages]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    if (isOpen) setTimeout(() => inputRef.current?.focus(), 60);
  }, [isOpen]);

  const clearChat = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setMessages([WELCOME]);
  }, []);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!input.trim() || isStreaming) return;

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
          className={cn(
            "fixed inset-x-2 bottom-2 sm:inset-x-auto sm:right-6 sm:bottom-6 z-50",
            "w-[calc(100vw-1rem)] sm:w-[400px]",
            "max-h-[min(560px,calc(100dvh-6rem))] flex flex-col",
            "rounded-xl border border-border/60 bg-card shadow-2xl shadow-black/40",
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
                    className="rounded-lg px-3 py-2 bg-muted motion-safe:animate-pulse"
                  >
                    <div className="flex gap-1">
                      <span
                        className="h-2 w-2 rounded-full bg-muted-foreground/60 motion-safe:animate-pulse"
                        style={{ animationDelay: "0ms" }}
                      />
                      <span
                        className="h-2 w-2 rounded-full bg-muted-foreground/60 motion-safe:animate-pulse"
                        style={{ animationDelay: "150ms" }}
                      />
                      <span
                        className="h-2 w-2 rounded-full bg-muted-foreground/60 motion-safe:animate-pulse"
                        style={{ animationDelay: "300ms" }}
                      />
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
            className="flex items-center gap-2 px-3 py-2.5 border-t border-border/50 bg-background/50 shrink-0"
          >
            <UserAvatar
              src={isLoggedIn ? userAvatar : null}
              name={isLoggedIn ? userName : "Guest"}
            />
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={
                isLoggedIn ? `Message as ${userName}...` : "Ask a question..."
              }
              disabled={isStreaming}
              style={{ fontSize: 16, touchAction: "manipulation" }}
              className="flex-1 text-sm bg-transparent outline-none placeholder:text-muted-foreground/40 disabled:opacity-50"
              autoComplete="off"
            />
            <Button
              type="submit"
              variant="ghost"
              size="sm"
              disabled={!input.trim() || isStreaming}
              className="h-11 w-11 p-0 shrink-0 text-muted-foreground hover:text-foreground touch-manipulation disabled:opacity-40"
              aria-label="Send"
            >
              {isStreaming ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </form>
        </div>
      )}

      {/* Floating trigger */}
      <button
        onClick={() => setIsOpen((v) => !v)}
        className={cn(
          "fixed bottom-4 right-4 sm:right-6 z-50",
          "h-14 w-14 sm:h-12 sm:w-12 rounded-full flex items-center justify-center",
          "border shadow-lg shadow-black/20",
          "transition-all duration-150 active:scale-95 touch-manipulation",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
          "pb-[env(safe-area-inset-bottom)]",
          isOpen
            ? "bg-card border-primary/60 text-foreground shadow-primary/10"
            : "bg-primary/10 border-primary/30 text-primary hover:bg-primary/20 hover:border-primary/60",
        )}
        aria-label={isOpen ? "Close AI assistant" : "Open AI assistant"}
      >
        {isOpen ? (
          <X className="h-5 w-5" />
        ) : (
          <MessageCircle className="h-5 w-5" />
        )}
      </button>
    </>
  );
}
