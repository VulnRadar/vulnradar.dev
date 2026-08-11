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
  Lock,
  AlertCircle,
} from "lucide-react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/ui/utils";
import { useAuth } from "@/components/providers/auth-provider";
import {
  APP_NAME,
  AI_CHAT_HISTORY_DAYS,
  AI_CHAT_MAX_INPUT_LENGTH,
} from "@/lib/config/constants";
import { parseSegments } from "@/lib/ai/think-parser";
import {
  SLASH_COMMANDS,
  buildHelpText,
  type SlashCommand,
} from "@/lib/ai/commands";
import { AI_CHAT_ASK_EVENT, type AiChatAskDetail } from "@/lib/ai/chat-bridge";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  cmdPill?: string;
  cmdState?: "loading" | "loaded" | "error";
  contextCmd?: string;
  /** Set when the bubble holds a failure rather than a reply, so it can be
   *  rendered as one instead of passing for an answer. */
  failed?: boolean;
};

type ProviderInfo = {
  configured: boolean;
  model: string;
  provider: string;
  aiDisabled?: boolean;
};

const STORAGE_KEY = "vulnradar_ai_chat_v1";
const PANEL_SIZE_KEY = "vulnradar_chat_size_v1";
const MAX_AGE_MS = AI_CHAT_HISTORY_DAYS * 24 * 60 * 60 * 1000;
const BOT_NAME = "Vera";

function loadPanelSize() {
  if (typeof window === "undefined") return { width: 420, height: 520 };
  try {
    const raw = localStorage.getItem(PANEL_SIZE_KEY);
    if (!raw) return { width: 420, height: 520 };
    const p = JSON.parse(raw);
    return {
      width: Math.max(300, Math.min(680, Number(p.width) || 420)),
      height: Math.max(300, Math.min(800, Number(p.height) || 520)),
    };
  } catch {
    return { width: 420, height: 520 };
  }
}

function savePanelSize(w: number, h: number) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(
      PANEL_SIZE_KEY,
      JSON.stringify({ width: w, height: h }),
    );
  } catch {}
}

function makeWelcome(): ChatMessage {
  return {
    id: "welcome",
    role: "assistant",
    content: `Hi, I'm ${BOT_NAME}. Ask me about scan findings, how to fix issues, API usage, or self-hosting ${APP_NAME}.\n\nType **/** to load context on demand, try \`/docs\`, \`/changelog\`, \`/history\`, and more.`,
  };
}

function uid(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID)
    return crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }
  return Date.now().toString(36);
}

function newSessionId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID)
    return crypto.randomUUID();
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const h = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
      "",
    );
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }
  return "s-" + Date.now().toString(36);
}

type StoredChat = {
  sessionId: string;
  messages: ChatMessage[];
  savedAt: number;
};

function loadStored(): StoredChat {
  const WELCOME = makeWelcome();
  if (typeof window === "undefined")
    return {
      sessionId: newSessionId(),
      messages: [WELCOME],
      savedAt: Date.now(),
    };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw)
      return {
        sessionId: newSessionId(),
        messages: [WELCOME],
        savedAt: Date.now(),
      };
    const parsed = JSON.parse(raw) as Partial<StoredChat>;
    if (!parsed.savedAt || Date.now() - parsed.savedAt > MAX_AGE_MS) {
      localStorage.removeItem(STORAGE_KEY);
      return {
        sessionId: newSessionId(),
        messages: [WELCOME],
        savedAt: Date.now(),
      };
    }
    return {
      sessionId: parsed.sessionId || newSessionId(),
      messages: parsed.messages?.length ? parsed.messages : [WELCOME],
      savedAt: parsed.savedAt,
    };
  } catch {
    return {
      sessionId: newSessionId(),
      messages: [WELCOME],
      savedAt: Date.now(),
    };
  }
}

function saveHistory(sessionId: string, messages: ChatMessage[]) {
  if (typeof window === "undefined") return;
  try {
    // Strip context messages — they're large and should not linger in storage
    const filtered = messages.filter(
      (m) => !m.contextCmd || m.contextCmd === "help",
    );
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ sessionId, messages: filtered, savedAt: Date.now() }),
    );
  } catch {
    // quota exceeded or private mode
  }
}

function persistConversation(sessionId: string, messages: ChatMessage[]) {
  const payload = messages
    .filter((m) => m.id !== "welcome" && m.content.trim())
    .filter((m) => !m.contextCmd || m.contextCmd === "help")
    .map((m) => ({ role: m.role, content: m.content }));
  if (payload.length === 0) return;
  fetch("/api/v3/ai/conversations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, messages: payload }),
  }).catch(() => {});
}

const mdComponents: Components = {
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
      ta.style.cssText = "position:fixed;opacity:0";
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
      className="absolute top-1 right-1 h-5 w-5 flex items-center justify-center rounded text-muted-foreground/40 hover:text-muted-foreground hover:bg-black/20 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-all touch-manipulation"
      title={copied ? "Copied" : "Copy"}
      aria-label={copied ? "Copied" : "Copy message"}
    >
      {copied ? (
        <Check className="h-2.5 w-2.5 text-emerald-500" />
      ) : (
        <Copy className="h-2.5 w-2.5" />
      )}
    </button>
  );
}

function ThinkBlock({ content }: { content: string }) {
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

function ContextPill({
  label,
  state,
}: {
  label: string;
  state: "loading" | "loaded" | "error";
}) {
  return (
    <div className="flex items-center gap-1.5 py-1.5 px-1">
      <span
        className={cn(
          "inline-flex items-center gap-1 font-mono border rounded px-2 py-0.5 text-[10px]",
          state === "error"
            ? "bg-destructive/8 border-destructive/20 text-destructive/70 opacity-70"
            : "bg-primary/8 border-primary/20 text-primary/70",
          state === "loading" && "opacity-60",
        )}
      >
        {state === "loading" && (
          <Loader2 className="h-2.5 w-2.5 animate-spin" />
        )}
        {state === "error" && <AlertCircle className="h-2.5 w-2.5" />}
        {label}
      </span>
      <span
        className={cn(
          "text-[10px]",
          state === "error"
            ? "text-destructive/40"
            : "text-muted-foreground/40",
        )}
      >
        {state === "loading"
          ? "loading..."
          : state === "error"
            ? "failed to load"
            : "context loaded"}
      </span>
    </div>
  );
}

// Reveals `raw` word-by-word when `active`. Think blocks are shown instantly;
// only the response text after the last </think> is typewritten.
function useTypewriter(raw: string, active: boolean): string {
  const thinkEnd = raw.lastIndexOf("</think>");
  const splitIdx = thinkEnd >= 0 ? thinkEnd + 8 : 0;
  const prefix = raw.slice(0, splitIdx);
  const suffix = raw.slice(splitIdx);

  const refState = useRef({ suffix, pos: 0, active });
  const [pos, setPos] = useState(0);
  refState.current.suffix = suffix;
  refState.current.active = active;

  useEffect(() => {
    if (!active) {
      setPos(Infinity);
      return;
    }
    setPos(0);
    refState.current.pos = 0;

    const id = window.setInterval(() => {
      const { suffix: s, pos: p, active: a } = refState.current;
      if (!a || p >= s.length) return;
      let next = p;
      while (next < s.length && s[next] !== " " && s[next] !== "\n") next++;
      next = Math.min(next + 1, s.length);
      refState.current.pos = next;
      setPos(next);
    }, 38);

    return () => clearInterval(id);
  }, [active]);

  if (!active) return raw;
  return prefix + suffix.slice(0, pos);
}

function MessageBubble({
  content,
  role,
  cmdPill,
  cmdState,
  isTyping = false,
  failed = false,
}: {
  content: string;
  role: "user" | "assistant";
  cmdPill?: string;
  cmdState?: "loading" | "loaded" | "error";
  isTyping?: boolean;
  failed?: boolean;
}) {
  const displayContent = useTypewriter(content, isTyping);
  const segments = useMemo(
    () => (role === "user" ? [] : parseSegments(displayContent)),
    [displayContent, role],
  );

  if (cmdPill !== undefined) {
    return <ContextPill label={cmdPill} state={cmdState ?? "loading"} />;
  }

  const isUser = role === "user";

  if (failed) {
    return (
      <div
        role="alert"
        className="flex items-start gap-2 max-w-[88%] mr-auto rounded-2xl rounded-tl-sm px-3.5 py-2.5 bg-destructive/8 border border-destructive/25 text-sm leading-relaxed text-destructive"
      >
        <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
        <span>{content}</span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "group relative text-sm leading-relaxed max-w-[88%] break-words",
        isUser
          ? "rounded-2xl rounded-tr-sm px-3.5 py-2.5 bg-primary text-primary-foreground whitespace-pre-wrap ml-auto"
          : "rounded-2xl rounded-tl-sm px-3.5 py-2.5 bg-muted/60 text-foreground border border-border/30 mr-auto",
      )}
    >
      {isUser
        ? displayContent
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

const QUICK_PROMPTS = [
  "What security headers should every site have?",
  "How do I fix a Content Security Policy issue?",
  "What does a high danger score actually mean?",
  "How do I enable HSTS on my server?",
  `How do I self-host ${APP_NAME}?`,
];

function SuggestedPrompts({ onSelect }: { onSelect: (p: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2 mt-3 pl-0.5">
      {QUICK_PROMPTS.map((p) => (
        <button
          key={p}
          type="button"
          onClick={() => onSelect(p)}
          className="text-[11px] px-3 py-1.5 rounded-full border border-primary/20 bg-primary/5 text-muted-foreground hover:text-foreground hover:bg-primary/10 hover:border-primary/35 transition-colors text-left leading-snug"
        >
          {p}
        </button>
      ))}
    </div>
  );
}

function ThinkingBubble() {
  return (
    <div className="rounded-2xl rounded-tl-sm px-3.5 py-2.5 bg-muted/60 border border-border/30 w-fit">
      <div className="flex items-center gap-1.5">
        <span
          className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50 animate-bounce"
          style={{ animationDelay: "0ms", animationDuration: "1s" }}
        />
        <span
          className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50 animate-bounce"
          style={{ animationDelay: "150ms", animationDuration: "1s" }}
        />
        <span
          className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50 animate-bounce"
          style={{ animationDelay: "300ms", animationDuration: "1s" }}
        />
      </div>
    </div>
  );
}

const COMMAND_INTROS: Record<string, string> = {
  docs: "The /docs context just loaded. In 1-2 sentences let me know and ask which part of the docs I need help with.",
  changelog:
    "The /changelog context just loaded. In 1-2 sentences mention it and ask what changes I'm curious about.",
  checks:
    "The /checks context just loaded. In 1-2 sentences let me know and ask what I want to know about the scanner checks.",
  stats:
    "The /stats context just loaded. Briefly summarize the key numbers and invite a follow-up question.",
  me: "The /me context just loaded. In 1-2 sentences let me know my account info is available and offer to help with anything account-related.",
  history:
    "The /history context just loaded. In 1-2 sentences let me know and ask what I want to know about the scan results.",
  finding:
    "The /finding context just loaded. In 1-2 sentences let me know and offer to help me understand or fix the vulnerability.",
};

const CONTEXT_TRIGGERS: { keywords: string[]; cmd: string }[] = [
  {
    keywords: [
      "how to",
      "set up",
      "setup",
      "install",
      "self-host",
      "selfhost",
      "deploy",
      "docker",
      "configure",
      "configuration",
      "documentation",
      "getting started",
      "quick start",
      "env var",
      "environment variable",
    ],
    cmd: "docs",
  },
  {
    keywords: [
      "changelog",
      "release notes",
      "what's new",
      "what changed",
      "latest version",
      "new in v",
      "recent update",
      "release history",
    ],
    cmd: "changelog",
  },
];

function getUniqueSuggestions(input: string): SlashCommand[] {
  const typed = input.slice(1).toLowerCase();
  const seen = new Set<string>();
  return SLASH_COMMANDS.filter((c) => {
    const full = c.args ? `${c.cmd} ${c.args}` : c.cmd;
    if (!full.startsWith(typed)) return false;
    const key = full;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 8);
}

export function ChatWidget() {
  const { me } = useAuth();
  const isLoggedIn = !!me?.userId;
  const pathname = usePathname();

  const [isOpen, setIsOpen] = useState(false);
  const [kbOffset, setKbOffset] = useState(0);
  // Same test the mobile bottom-sheet body-scroll-lock effect below uses:
  // narrow viewport or coarse (touch) pointer. Drives the render-time
  // decision to skip the desktop drag-resize dimensions and let the
  // full-screen CSS classes take over instead.
  const [isMobile, setIsMobile] = useState(false);
  const [sessionId, setSessionId] = useState<string>(
    () => loadStored().sessionId,
  );
  const [messages, setMessages] = useState<ChatMessage[]>(
    () => loadStored().messages,
  );
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [isLoadingCmd, setIsLoadingCmd] = useState(false);
  const [provider, setProvider] = useState<ProviderInfo | null>(null);
  const [cmdSuggestions, setCmdSuggestions] = useState<SlashCommand[]>([]);
  const [cmdHighlight, setCmdHighlight] = useState(0);
  const [streamingMsgId, setStreamingMsgId] = useState<string | null>(null);
  const [panelWidth, setPanelWidth] = useState(() => loadPanelSize().width);
  const [panelHeight, setPanelHeight] = useState(() => loadPanelSize().height);
  const currentSizeRef = useRef({ w: 420, h: 520 });
  const [isPinnedToBottom, setIsPinnedToBottom] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  // Always points at the current render's sendMessage (defined further down,
  // closing over the latest `messages`), so the AI_CHAT_ASK_EVENT listener
  // below -- which only re-subscribes when isLoggedIn changes, not on every
  // render -- never calls a stale closure holding an outdated message list.
  const sendMessageRef = useRef<(text: string) => Promise<void>>(
    async () => {},
  );

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px), (pointer: coarse)");
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  // Wipe in-memory state when the user signs out so no conversation data
  // lingers in the component (localStorage is cleared by clearAuthCache).
  const prevLoggedInRef = useRef(isLoggedIn);
  useEffect(() => {
    const wasLoggedIn = prevLoggedInRef.current;
    prevLoggedInRef.current = isLoggedIn;
    if (wasLoggedIn && !isLoggedIn) {
      try {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(PANEL_SIZE_KEY);
      } catch {}
      const freshId = newSessionId();
      setSessionId(freshId);
      setMessages([makeWelcome()]);
      setIsOpen(false);
      setInput("");
      setIsStreaming(false);
      setStreamingMsgId(null);
    }
  }, [isLoggedIn]);

  useEffect(() => {
    currentSizeRef.current.w = panelWidth;
  }, [panelWidth]);
  useEffect(() => {
    currentSizeRef.current.h = panelHeight;
  }, [panelHeight]);

  function onWidthResizeStart(e: React.MouseEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startW = panelWidth;
    function onMove(ev: MouseEvent) {
      setPanelWidth(
        Math.max(300, Math.min(680, startW + (startX - ev.clientX))),
      );
    }
    function onUp() {
      savePanelSize(currentSizeRef.current.w, currentSizeRef.current.h);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  function onHeightResizeStart(e: React.MouseEvent) {
    e.preventDefault();
    const startY = e.clientY;
    const startH = panelHeight;
    function onMove(ev: MouseEvent) {
      setPanelHeight(
        Math.max(300, Math.min(800, startH + (startY - ev.clientY))),
      );
    }
    function onUp() {
      savePanelSize(currentSizeRef.current.w, currentSizeRef.current.h);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  useEffect(() => {
    saveHistory(sessionId, messages);
  }, [sessionId, messages]);

  const scrollToBottom = useCallback((smooth = false) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({
      top: el.scrollHeight,
      behavior: smooth ? "smooth" : "auto",
    });
    setIsPinnedToBottom(true);
  }, []);

  // Following the stream is the default, but scrolling up to re-read
  // something must not be yanked back down on the next token.
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    setIsPinnedToBottom(distance < 48);
  }, []);

  useEffect(() => {
    if (isPinnedToBottom) scrollToBottom();
  }, [messages, isPinnedToBottom, scrollToBottom]);

  useEffect(() => {
    if (!isOpen) return;
    const t = window.setTimeout(() => scrollToBottom(), 60);
    return () => window.clearTimeout(t);
  }, [isOpen, scrollToBottom]);

  // Fetch provider info eagerly on mount so it's ready before the widget opens
  useEffect(() => {
    fetch("/api/v3/ai/info")
      .then((r) => r.json())
      .then((d) => setProvider(d as ProviderInfo))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!isOpen) return;

    // Focus the composer, or the panel itself when the sign-in gate is up
    // and there is no composer to focus.
    const focusTimer = window.setTimeout(() => {
      const el = inputRef.current;
      if (el) el.focus();
      else panelRef.current?.focus();
    }, 80);

    // The body scroll lock exists for the mobile bottom sheet: iOS Safari
    // rubber-bands the page behind a fixed sheet and moves the viewport under
    // the keyboard. On a pointer device it is not only unnecessary, it is
    // harmful. globals.css keeps a permanent scrollbar gutter on <html>, and
    // `position: fixed` on <body> collapses the document height, which
    // removes that gutter and shifts the whole page sideways as the panel
    // opens. So: only lock where the sheet actually needs it.
    const isSheet =
      window.matchMedia("(max-width: 639px)").matches ||
      window.matchMedia("(pointer: coarse)").matches;

    const scrollY = window.scrollY;
    if (isSheet) {
      const s = document.body.style;
      s.position = "fixed";
      s.top = `-${scrollY}px`;
      s.left = "0";
      s.right = "0";
      s.width = "100%";
    }

    const vv = window.visualViewport;
    const update = () => {
      if (!vv) return;
      // offsetTop accounts for iOS viewport scroll (e.g. form assist bar)
      const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      setKbOffset(kb);
    };
    if (isSheet) {
      vv?.addEventListener("resize", update);
      vv?.addEventListener("scroll", update);
      update();
    }

    return () => {
      window.clearTimeout(focusTimer);
      if (isSheet) {
        // Clear only the properties this effect set, so an inline style put
        // on <body> by anything else survives.
        const s = document.body.style;
        s.position = "";
        s.top = "";
        s.left = "";
        s.right = "";
        s.width = "";
        window.scrollTo(0, scrollY);
        vv?.removeEventListener("resize", update);
        vv?.removeEventListener("scroll", update);
      }
      setKbOffset(0);
    };
  }, [isOpen]);

  // Scroll messages to bottom whenever the keyboard appears
  useEffect(() => {
    if (kbOffset <= 0) return;
    const t = window.setTimeout(() => scrollToBottom(true), 100);
    return () => window.clearTimeout(t);
  }, [kbOffset, scrollToBottom]);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      const t = e.target as Node | null;
      if (!t) return;
      // The launcher is the close control on desktop, so a click on it must
      // not also register as "outside" or the two would cancel out.
      if (toggleRef.current?.contains(t)) return;
      if (panelRef.current && !panelRef.current.contains(t)) {
        setIsOpen(false);
      }
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // The slash-command list owns Escape while it is open.
      if (cmdSuggestions.length > 0) return;
      setIsOpen(false);
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", onKey);
    };
  }, [isOpen, cmdSuggestions.length]);

  // Opens the panel and, once signed in, sends a pre-seeded prompt on
  // behalf of another component (see lib/ai/chat-bridge.ts) -- the "Ask
  // about this" button under an AI scan summary dispatches this instead of
  // duplicating chat UI of its own.
  useEffect(() => {
    function onAsk(e: Event) {
      const detail = (e as CustomEvent<AiChatAskDetail>).detail;
      if (!detail?.prompt) return;
      setIsOpen(true);
      if (isLoggedIn) void sendMessageRef.current(detail.prompt);
    }
    window.addEventListener(AI_CHAT_ASK_EVENT, onAsk);
    return () => window.removeEventListener(AI_CHAT_ASK_EVENT, onAsk);
  }, [isLoggedIn]);

  // Focus goes back to the control that opened the panel, but only after it
  // has actually been opened once, so the launcher does not steal focus on
  // first paint.
  const hasOpenedRef = useRef(false);
  useEffect(() => {
    if (isOpen) {
      hasOpenedRef.current = true;
      return;
    }
    if (hasOpenedRef.current) toggleRef.current?.focus();
  }, [isOpen]);

  const clearChat = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    const freshId = newSessionId();
    setSessionId(freshId);
    setMessages([makeWelcome()]);
  }, []);

  // Input is already hard-capped at AI_CHAT_MAX_INPUT_LENGTH (maxLength prop
  // plus the truncating slice() on change), so it can reach the limit but
  // never exceed it. "At the limit" is a full input, not an invalid one, it
  // must not block sending.
  const atLimit = input.length >= AI_CHAT_MAX_INPUT_LENGTH;
  const canSend = input.trim().length > 0 && !isStreaming && !isLoadingCmd;

  const autoResize = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 140) + "px";
  }, []);

  useEffect(() => {
    autoResize();
  }, [input, autoResize]);

  const handleInputChange = useCallback((val: string) => {
    setInput(val.slice(0, AI_CHAT_MAX_INPUT_LENGTH));
    if (val.startsWith("/")) {
      const suggestions = getUniqueSuggestions(val);
      setCmdSuggestions(suggestions);
      setCmdHighlight(0);
    } else {
      setCmdSuggestions([]);
    }
  }, []);

  const applySuggestion = useCallback((cmd: SlashCommand) => {
    const text = cmd.args ? `/${cmd.cmd} ` : `/${cmd.cmd}`;
    setInput(text);
    setCmdSuggestions([]);
    setTimeout(() => inputRef.current?.focus(), 0);
  }, []);

  async function streamToMessage(
    aiMessages: { role: string; content: string }[],
    aiMsgId: string,
  ): Promise<void> {
    const res = await fetch("/api/v3/ai/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: aiMessages }),
    });

    const providerName = res.headers.get("X-AI-Provider-Name");
    const modelName = res.headers.get("X-AI-Model");
    if (providerName) {
      setProvider((prev) =>
        prev
          ? {
              ...prev,
              provider: providerName || prev.provider,
              model: modelName || prev.model,
            }
          : {
              configured: true,
              provider: providerName || "AI",
              model: modelName || "",
            },
      );
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Request failed." }));
      setMessages((prev) =>
        prev.map((m) =>
          m.id === aiMsgId
            ? {
                ...m,
                content:
                  err.error ||
                  "That request did not go through. Send it again.",
                failed: true,
              }
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
    setMessages((prev) => {
      persistConversation(sessionId, prev);
      return prev;
    });
  }

  async function handleCommand(raw: string): Promise<ChatMessage[]> {
    const parts = raw.trim().slice(1).split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const arg = parts.slice(1).join(" ");

    // /help renders a command list — the only command with visible output
    if (cmd === "help") {
      const helpMsg: ChatMessage = {
        id: uid(),
        role: "assistant",
        content: buildHelpText(),
        contextCmd: "help",
      };
      setMessages((prev) => [
        ...prev.filter((m) => m.contextCmd !== "help"),
        helpMsg,
      ]);
      return [helpMsg];
    }

    // All other commands inject context silently — no pills, no summaries
    setIsLoadingCmd(true);
    try {
      const url = new URL("/api/v3/ai/context", window.location.origin);
      url.searchParams.set("cmd", cmd);
      if (arg) url.searchParams.set("id", arg);

      const res = await fetch(url.toString());
      if (!res.ok) return [];

      const data = (await res.json()) as {
        cmd: string;
        label: string;
        summary: string;
        content: string;
      };

      const contextMsg: ChatMessage = {
        id: uid(),
        role: "user",
        content: `<context cmd="${data.cmd}">\n${data.content}\n</context>`,
        contextCmd: cmd,
      };

      // Replace any stale context for this command, then append fresh one
      setMessages((prev) => [
        ...prev.filter((m) => m.contextCmd !== cmd),
        contextMsg,
      ]);
      return [contextMsg];
    } catch {
      return [];
    } finally {
      setIsLoadingCmd(false);
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (cmdSuggestions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setCmdHighlight((h) => Math.min(h + 1, cmdSuggestions.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setCmdHighlight((h) => Math.max(h - 1, 0));
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        applySuggestion(cmdSuggestions[cmdHighlight]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setCmdSuggestions([]);
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (canSend) handleSubmit(e);
    }
  }

  async function sendMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed || isStreaming || isLoadingCmd) return;

    setInput("");
    setCmdSuggestions([]);
    autoResize();
    inputRef.current?.focus();

    // Slash command — load context, then stream an AI intro response
    if (trimmed.startsWith("/")) {
      const cmdCtx = await handleCommand(trimmed);
      const cmd = trimmed.trim().slice(1).split(/\s+/)[0].toLowerCase();
      // help renders its own output; failed fetches return []
      if (cmd === "help" || cmdCtx.length === 0) return;

      const introPrompt =
        COMMAND_INTROS[cmd] ??
        "Let me know the context was loaded and briefly offer to help.";
      const triggerMsg: ChatMessage = {
        id: uid(),
        role: "user",
        content: introPrompt,
        contextCmd: cmd,
      };
      const aiMsgId = uid();
      setMessages((prev) => [
        ...prev,
        triggerMsg,
        { id: aiMsgId, role: "assistant", content: "" },
      ]);
      setIsStreaming(true);
      setStreamingMsgId(aiMsgId);
      try {
        const aiMessages = [...messages, ...cmdCtx, triggerMsg]
          .filter((m) => m.id !== "welcome")
          .filter((m) => m.cmdPill === undefined || m.cmdState === "loaded")
          .map((m) => ({ role: m.role, content: m.content }));
        await streamToMessage(aiMessages, aiMsgId);
      } catch {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === aiMsgId
              ? {
                  ...m,
                  content:
                    "That did not reach the model. Check your connection and send it again.",
                  failed: true,
                }
              : m,
          ),
        );
      } finally {
        setIsStreaming(false);
        setStreamingMsgId(null);
      }
      return;
    }

    // Regular message: clear stale help context so the AI isn't confused
    setMessages((prev) => prev.filter((m) => m.contextCmd !== "help"));

    // Auto-load context when keywords match a trigger and it isn't already loaded
    let autoCtx: ChatMessage[] = [];
    const lower = trimmed.toLowerCase();
    for (const trigger of CONTEXT_TRIGGERS) {
      if (trigger.keywords.some((k) => lower.includes(k))) {
        const alreadyLoaded = messages.some(
          (m) =>
            m.cmdPill?.startsWith(`/${trigger.cmd}`) && m.cmdState === "loaded",
        );
        if (!alreadyLoaded) {
          autoCtx = await handleCommand(`/${trigger.cmd}`);
        }
        break;
      }
    }

    const userMsg: ChatMessage = {
      id: uid(),
      role: "user",
      content: trimmed,
    };
    const aiMsgId = uid();

    setMessages((prev) => [
      ...prev,
      userMsg,
      { id: aiMsgId, role: "assistant", content: "" },
    ]);
    setIsStreaming(true);
    setStreamingMsgId(aiMsgId);

    try {
      // Build messages for AI — include context pills (they carry the <context> content)
      // but skip loading/error placeholders. autoCtx is appended explicitly because React
      // state hasn't flushed the setMessages calls from handleCommand yet.
      // Deduplicate context slots: when the same command was loaded twice, keep only the latest.
      const history = [...messages, ...autoCtx, userMsg];
      const filteredHistory = history
        .filter((m) => m.id !== "welcome")
        .filter((m) => m.cmdPill === undefined || m.cmdState === "loaded");

      const seenCtx = new Set<string>();
      const dedupedHistory = [...filteredHistory]
        .reverse()
        .filter((m) => {
          if (m.contextCmd && m.cmdPill) {
            if (seenCtx.has(m.contextCmd)) return false;
            seenCtx.add(m.contextCmd);
          }
          return true;
        })
        .reverse();

      const aiMessages = dedupedHistory.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      await streamToMessage(aiMessages, aiMsgId);
    } catch {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === aiMsgId
            ? {
                ...m,
                content:
                  "That did not reach the model. Check your connection and send it again.",
                failed: true,
              }
            : m,
        ),
      );
    } finally {
      setIsStreaming(false);
      setStreamingMsgId(null);
    }
  }

  async function handleSubmit(
    e: FormEvent<HTMLFormElement> | KeyboardEvent<HTMLTextAreaElement>,
  ) {
    e.preventDefault();
    if (!canSend) return;
    await sendMessage(input);
  }

  useEffect(() => {
    sendMessageRef.current = sendMessage;
  });

  const providerLabel =
    provider?.provider && provider.provider !== "Custom LLM"
      ? provider.provider
      : provider?.model
        ? provider.model
        : null;

  if (provider?.aiDisabled) return null;
  // The live browser session viewer has its own focused UI; a floating
  // chat button on top of it is a distraction, not a feature.
  if (pathname?.startsWith("/browser/")) return null;
  // Docs pages have their own floating "Contents" trigger in the same
  // bottom-right corner (see components/docs/docs-mobile-nav.tsx) -- a
  // second floating button there is clutter, not help, and readers digging
  // through reference material are already self-serving. Admin pages are
  // for staff operating the platform, not the audience this support widget
  // is built for.
  if (pathname?.startsWith("/docs") || pathname?.startsWith("/admin"))
    return null;

  return (
    <>
      {/* Panel */}
      {isOpen && (
        <div
          ref={panelRef}
          style={
            kbOffset > 0
              ? {
                  bottom: `${kbOffset}px`,
                  maxHeight: `${window.innerHeight - kbOffset - 8}px`,
                }
              : isMobile
                ? undefined
                : { width: panelWidth, height: panelHeight }
          }
          className={cn(
            // Mobile: genuinely full screen, edge to edge. inset-0 alone
            // (no explicit width/height, see the style prop above) fills the
            // viewport without relying on the desktop drag-resize state.
            "fixed inset-0 z-50",
            "flex flex-col",
            // Desktop: floating popup anchored bottom-right, sized by the
            // resizable panelWidth/panelHeight state via the style prop
            "sm:inset-x-auto sm:inset-y-auto sm:right-5 sm:bottom-20",
            "sm:rounded-xl",
            // Visuals
            "bg-card border border-border/60",
            "shadow-2xl shadow-black/50",
            "overflow-hidden",
          )}
          role="dialog"
          aria-label={`${BOT_NAME} AI assistant`}
          tabIndex={-1}
        >
          {/* Resize handle — desktop only, drag left edge for width */}
          <div
            onMouseDown={onWidthResizeStart}
            className="hidden sm:block absolute left-0 top-0 bottom-0 w-1 cursor-col-resize z-10 hover:bg-primary/20 transition-colors rounded-l-xl"
            title="Drag to resize width"
          />
          {/* Resize handle — desktop only, drag top edge for height */}
          <div
            onMouseDown={onHeightResizeStart}
            className="hidden sm:block absolute top-0 left-0 right-0 h-1 cursor-row-resize z-10 hover:bg-primary/20 transition-colors rounded-t-xl"
            title="Drag to resize height"
          />
          {/* Header. Top padding grows for the notch/status bar now that the
              mobile sheet reaches the very top edge of the screen. */}
          <div
            className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border/40 bg-card shrink-0"
            style={{
              paddingTop: "max(0.75rem, env(safe-area-inset-top, 0px))",
            }}
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="relative shrink-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/favicon.svg"
                  alt={APP_NAME}
                  className="h-6 w-6 rounded-full"
                />
                <span className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full bg-emerald-500 border-2 border-card" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-mono font-semibold tracking-tight leading-none">
                  {BOT_NAME}
                </p>
                <p className="text-[10px] text-muted-foreground mt-0.5 leading-none">
                  Security Assistant
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {providerLabel && (
                <span className="hidden sm:inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-medium bg-primary/10 text-primary/70 border border-primary/15 leading-none mr-1">
                  {providerLabel}
                </span>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={clearChat}
                className="h-8 w-8 p-0 text-muted-foreground/50 hover:text-foreground touch-manipulation"
                title="Clear conversation"
                aria-label="Clear conversation"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
              {/* Mobile only: the panel is a full-width bottom sheet here, so
                  this is the top-right close a user expects on that layout.
                  Desktop closes via the launcher button, which becomes an X
                  while the panel is open, so this is redundant there. */}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsOpen(false)}
                className="h-8 w-8 p-0 text-muted-foreground/50 hover:text-foreground touch-manipulation sm:hidden"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Sign-in gate */}
          {!isLoggedIn ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6 py-10 text-center">
              <div className="h-12 w-12 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center">
                <Lock className="h-5 w-5 text-primary/60" />
              </div>
              <div className="space-y-1.5">
                <p className="text-sm font-semibold">Sign in to use AI chat</p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Ask questions about scan findings, how to fix issues, or how
                  to set up {APP_NAME}.
                </p>
              </div>
              <a
                href="/login"
                className="inline-flex items-center justify-center h-9 px-5 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                Sign in
              </a>
            </div>
          ) : (
            <>
              {/* Messages */}
              <div className="relative flex-1 min-h-0">
                <div
                  ref={scrollRef}
                  onScroll={handleScroll}
                  className="h-full overflow-y-auto overscroll-contain px-3 py-4 space-y-3"
                  style={
                    { WebkitOverflowScrolling: "touch" } as React.CSSProperties
                  }
                >
                  {messages
                    .filter((m) => !m.contextCmd || m.contextCmd === "help")
                    .map((m) => (
                      <div
                        key={m.id}
                        className={cn(
                          "flex flex-col",
                          m.cmdPill !== undefined
                            ? "items-start"
                            : m.role === "user"
                              ? "items-end"
                              : "items-start",
                        )}
                      >
                        {(() => {
                          const thinkStart = m.content.indexOf("<think>");
                          const thinkEnd = m.content.lastIndexOf("</think>");
                          // If inside an unclosed think block, no response text yet
                          let responseText: string;
                          if (thinkStart >= 0 && thinkEnd < 0) {
                            responseText = "";
                          } else if (thinkEnd >= 0) {
                            responseText = m.content.slice(thinkEnd + 8);
                          } else {
                            responseText = m.content;
                          }
                          const responseWords = responseText.trim()
                            ? responseText.trim().split(/\s+/).length
                            : 0;
                          const showDots =
                            m.role === "assistant" &&
                            m.cmdPill === undefined &&
                            !m.failed &&
                            (m.content === "" ||
                              (m.id === streamingMsgId && responseWords < 6));
                          return showDots ? (
                            <ThinkingBubble />
                          ) : (
                            <MessageBubble
                              content={m.content}
                              role={m.role}
                              cmdPill={m.cmdPill}
                              cmdState={m.cmdState}
                              isTyping={m.id === streamingMsgId}
                              failed={m.failed}
                            />
                          );
                        })()}
                        {m.id === "welcome" && messages.length === 1 && (
                          <SuggestedPrompts onSelect={(p) => sendMessage(p)} />
                        )}
                      </div>
                    ))}
                </div>

                {/* Reappears once you scroll away from the live edge, so
                  reading back through history doesn't fight the stream. */}
                {!isPinnedToBottom && (
                  <button
                    type="button"
                    onClick={() => scrollToBottom(true)}
                    className="absolute bottom-3 right-3 flex items-center gap-1 pl-2.5 pr-3 py-1.5 rounded-full text-xs font-medium bg-card border border-border/60 text-foreground shadow-md hover:bg-muted transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
                  >
                    <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                    Latest
                  </button>
                )}
              </div>

              {/* Input area with autocomplete */}
              <div className="relative shrink-0">
                {/* Slash command autocomplete */}
                {cmdSuggestions.length > 0 && (
                  <div className="absolute bottom-full left-3 right-3 mb-1 bg-card border border-border/60 rounded-lg shadow-lg shadow-black/30 overflow-hidden z-10">
                    {cmdSuggestions.map((c, i) => {
                      const needsAuth = c.requiresAuth && !isLoggedIn;
                      return (
                        <button
                          key={`${c.cmd}-${c.args ?? ""}-${i}`}
                          type="button"
                          onClick={() => {
                            if (needsAuth) return;
                            applySuggestion(c);
                          }}
                          className={cn(
                            "w-full flex items-center gap-2 px-3 py-2 text-left transition-colors text-xs",
                            i === cmdHighlight
                              ? "bg-primary/10 text-foreground"
                              : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                            needsAuth && "opacity-50 cursor-not-allowed",
                          )}
                        >
                          <span className="font-mono text-primary/80 shrink-0">
                            /{c.cmd}
                            {c.args ? ` ${c.args}` : ""}
                          </span>
                          <span className="text-muted-foreground/70 truncate">
                            {c.description}
                          </span>
                          {needsAuth && (
                            <Lock className="h-2.5 w-2.5 ml-auto shrink-0 text-muted-foreground/40" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}

                <form
                  onSubmit={handleSubmit}
                  className="px-3 pt-2 pb-2 border-t border-border/40 bg-card/80 backdrop-blur-sm"
                  style={{
                    paddingBottom:
                      "calc(0.5rem + env(safe-area-inset-bottom, 0px))",
                  }}
                >
                  <div className="flex items-end gap-2">
                    <textarea
                      ref={inputRef}
                      value={input}
                      onChange={(e) => {
                        handleInputChange(e.target.value);
                        autoResize();
                      }}
                      onKeyDown={handleKeyDown}
                      placeholder="Ask a question or type / for commands..."
                      disabled={isStreaming || isLoadingCmd}
                      maxLength={AI_CHAT_MAX_INPUT_LENGTH}
                      rows={1}
                      style={{ minHeight: "36px", maxHeight: "140px" }}
                      className={cn(
                        // iOS Safari auto-zooms the whole page on focus for any
                        // input/textarea with a computed font-size under 16px.
                        // text-base (16px) below sm: avoids that; sm:text-sm
                        // keeps the tighter desktop size where zoom never fires.
                        "flex-1 text-base sm:text-sm bg-muted/40 border rounded-xl px-3 py-2 resize-none overflow-y-auto",
                        "placeholder:text-muted-foreground/40 leading-snug outline-none",
                        "transition-colors focus:border-primary/50 focus:bg-muted/60",
                        "disabled:opacity-50",
                        atLimit ? "border-destructive/40" : "border-border/40",
                      )}
                      autoComplete="off"
                    />
                    <Button
                      type="submit"
                      size="sm"
                      disabled={!canSend}
                      className="h-9 w-9 p-0 shrink-0 rounded-lg touch-manipulation"
                      aria-label="Send"
                    >
                      {isStreaming || isLoadingCmd ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Send className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  </div>
                  {input.length > AI_CHAT_MAX_INPUT_LENGTH * 0.75 && (
                    <p
                      className={cn(
                        "mt-1 text-[10px] text-right tabular-nums",
                        atLimit
                          ? "text-destructive"
                          : "text-muted-foreground/50",
                      )}
                    >
                      {input.length}/{AI_CHAT_MAX_INPUT_LENGTH}
                    </p>
                  )}
                </form>
              </div>

              {/* Footer */}
              <div className="px-3 py-1.5 border-t border-border/20 shrink-0">
                <p className="text-[10px] text-muted-foreground/40 leading-snug">
                  AI can be wrong. Verify critical findings manually.
                </p>
              </div>
            </>
          )}
        </div>
      )}

      {/* Launcher. Always mounted so it can double as the desktop close
          control: once open, it swaps to an X in the same spot rather than
          disappearing. On mobile the panel is a full-width bottom sheet with
          its own top-right close button, so the launcher just gets out of
          the way there instead of sitting on top of the sheet. */}
      <button
        ref={toggleRef}
        onClick={() => setIsOpen((v) => !v)}
        className={cn(
          "fixed bottom-5 right-5 z-50",
          "h-14 w-14 rounded-full flex items-center justify-center",
          "bg-primary text-primary-foreground",
          "hover:bg-primary/90",
          "shadow-lg",
          "transition-all duration-150 active:scale-95 touch-manipulation",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2",
          isOpen && "hidden sm:flex",
        )}
        aria-label={isOpen ? "Close chat" : `Open ${BOT_NAME}`}
        aria-expanded={isOpen}
      >
        {isOpen ? (
          <X className="h-6 w-6" />
        ) : (
          <MessageCircle className="h-6 w-6" />
        )}
      </button>
    </>
  );
}
