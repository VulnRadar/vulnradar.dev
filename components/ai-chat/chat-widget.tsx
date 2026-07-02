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

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  cmdPill?: string;
  cmdState?: "loading" | "loaded" | "error";
  contextCmd?: string;
};

type ProviderInfo = {
  configured: boolean;
  model: string;
  provider: string;
};

const STORAGE_KEY = "vulnradar_ai_chat_v1";
const MAX_AGE_MS = AI_CHAT_HISTORY_DAYS * 24 * 60 * 60 * 1000;

function makeWelcome(): ChatMessage {
  return {
    id: "welcome",
    role: "assistant",
    content: `Ask me about scan findings, how to fix issues, API usage, or self-hosting ${APP_NAME}.\n\nType **/** to load context on demand — try \`/docs\`, \`/changelog\`, \`/history\`, and more.`,
  };
}

function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function newSessionId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID)
    return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
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
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ sessionId, messages, savedAt: Date.now() }),
    );
  } catch {
    // quota exceeded or private mode
  }
}

function persistConversation(sessionId: string, messages: ChatMessage[]) {
  const payload = messages
    .filter((m) => m.id !== "welcome" && m.content.trim())
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

function MessageBubble({
  content,
  role,
  cmdPill,
  cmdState,
}: {
  content: string;
  role: "user" | "assistant";
  cmdPill?: string;
  cmdState?: "loading" | "loaded" | "error";
}) {
  const segments = useMemo(
    () => (role === "user" ? [] : parseSegments(content)),
    [content, role],
  );

  if (cmdPill !== undefined) {
    return <ContextPill label={cmdPill} state={cmdState ?? "loading"} />;
  }

  const isUser = role === "user";

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
  const userName = me?.name || "Guest";

  const [isOpen, setIsOpen] = useState(false);
  const [kbOffset, setKbOffset] = useState(0);
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
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    saveHistory(sessionId, messages);
  }, [sessionId, messages]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Fetch provider info eagerly on mount so it's ready before the widget opens
  useEffect(() => {
    fetch("/api/v3/ai/info")
      .then((r) => r.json())
      .then((d) => setProvider(d as ProviderInfo))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    setTimeout(() => inputRef.current?.focus(), 80);

    // iOS body scroll lock: position:fixed preserves scroll position
    const scrollY = window.scrollY;
    document.body.style.cssText = `position:fixed;top:-${scrollY}px;left:0;right:0;overflow-y:scroll`;

    const vv = window.visualViewport;
    const update = () => {
      if (!vv) return;
      // offsetTop accounts for iOS viewport scroll (e.g. form assist bar)
      const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      setKbOffset(kb);
    };
    vv?.addEventListener("resize", update);
    vv?.addEventListener("scroll", update);
    update();

    return () => {
      document.body.style.cssText = "";
      window.scrollTo(0, scrollY);
      vv?.removeEventListener("resize", update);
      vv?.removeEventListener("scroll", update);
      setKbOffset(0);
    };
  }, [isOpen]);

  // Scroll messages to bottom whenever the keyboard appears
  useEffect(() => {
    if (kbOffset > 0 && scrollRef.current) {
      setTimeout(() => {
        scrollRef.current?.scrollTo({
          top: scrollRef.current.scrollHeight,
          behavior: "smooth",
        });
      }, 100);
    }
  }, [kbOffset]);

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
    const freshId = newSessionId();
    setSessionId(freshId);
    setMessages([makeWelcome()]);
  }, []);

  const atLimit = input.length >= AI_CHAT_MAX_INPUT_LENGTH;
  const canSend =
    input.trim().length > 0 && !isStreaming && !isLoadingCmd && !atLimit;

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

  async function handleCommand(raw: string): Promise<ChatMessage[]> {
    const parts = raw.trim().slice(1).split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const arg = parts.slice(1).join(" ");

    // /help is instant — render client-side, no API round-trip
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

    // Loading any real command: clear help slot + replace existing slot for this command
    setMessages((prev) =>
      prev.filter((m) => m.contextCmd !== "help" && m.contextCmd !== cmd),
    );

    const pillId = uid();
    const loadingPill: ChatMessage = {
      id: pillId,
      role: "user",
      content: "",
      cmdPill: `/${cmd}${arg ? ` ${arg}` : ""}`,
      cmdState: "loading",
      contextCmd: cmd,
    };
    setMessages((prev) => [...prev, loadingPill]);
    setIsLoadingCmd(true);

    try {
      const url = new URL("/api/v3/ai/context", window.location.origin);
      url.searchParams.set("cmd", cmd);
      if (arg) url.searchParams.set("id", arg);

      const res = await fetch(url.toString());
      if (!res.ok) {
        const err = await res
          .json()
          .catch(() => ({ error: "Failed to load context." }));
        setMessages((prev) =>
          prev.map((m) =>
            m.id === pillId
              ? { ...m, cmdPill: `/${cmd}`, cmdState: "error" as const }
              : m,
          ),
        );
        const errMsg: ChatMessage = {
          id: uid(),
          role: "assistant",
          content: err.error || "Failed to load that context.",
          contextCmd: cmd,
        };
        setMessages((prev) => [...prev, errMsg]);
        return [];
      }

      const data = (await res.json()) as {
        cmd: string;
        label: string;
        summary: string;
        content: string;
      };

      const updatedPill: ChatMessage = {
        id: pillId,
        role: "user",
        content: `<context cmd="${data.cmd}">\n${data.content}\n</context>`,
        cmdPill: `/${data.cmd}${arg ? ` ${arg}` : ""} — ${data.label}`,
        cmdState: "loaded",
        contextCmd: cmd,
      };
      setMessages((prev) =>
        prev.map((m) => (m.id === pillId ? updatedPill : m)),
      );

      const summaryMsg: ChatMessage = {
        id: uid(),
        role: "assistant",
        content: data.summary,
        contextCmd: cmd,
      };
      setMessages((prev) => [...prev, summaryMsg]);

      return [updatedPill, summaryMsg];
    } catch {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === pillId
            ? { ...m, cmdPill: `/${cmd}`, cmdState: "error" as const }
            : m,
        ),
      );
      setMessages((prev) => [
        ...prev,
        {
          id: uid(),
          role: "assistant",
          content: "Something went wrong loading that context.",
          contextCmd: cmd,
        },
      ]);
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

  async function handleSubmit(
    e: FormEvent<HTMLFormElement> | KeyboardEvent<HTMLTextAreaElement>,
  ) {
    e.preventDefault();
    if (!canSend) return;

    const trimmed = input.trim();
    setInput("");
    setCmdSuggestions([]);
    autoResize();

    // Slash command — load context, don't stream to AI
    if (trimmed.startsWith("/")) {
      await handleCommand(trimmed);
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
          // handleCommand clears help context automatically for non-help commands
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

      const res = await fetch("/api/v3/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userName, messages: aiMessages }),
      });

      // Update provider info from response headers
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
      // Persist to DB after stream completes
      setMessages((prev) => {
        persistConversation(sessionId, prev);
        return prev;
      });
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

  const providerLabel =
    provider?.provider && provider.provider !== "Custom LLM"
      ? provider.provider
      : provider?.model
        ? provider.model
        : null;

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
              : undefined
          }
          className={cn(
            // Mobile: bottom sheet
            "fixed inset-x-0 bottom-0 z-50",
            "max-h-[85dvh] flex flex-col",
            "rounded-t-2xl",
            // Desktop: floating popup anchored bottom-right
            "sm:inset-x-auto sm:inset-y-auto sm:right-5 sm:bottom-20",
            "sm:w-[360px] sm:h-auto sm:max-h-[min(480px,calc(100dvh-100px))]",
            "sm:rounded-xl",
            // Visuals
            "bg-card border border-border/60",
            "shadow-2xl shadow-black/50",
            "overflow-hidden",
          )}
          role="dialog"
          aria-label={`${APP_NAME} AI assistant`}
        >
          {/* Header */}
          <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border/40 bg-card shrink-0">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="relative shrink-0">
                <img
                  src="/favicon.svg"
                  alt={APP_NAME}
                  className="h-6 w-6 rounded-full"
                />
                <span className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full bg-emerald-500 border-2 border-card" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-mono font-semibold tracking-tight leading-none">
                  {APP_NAME} AI
                </p>
                <p className="text-[10px] text-muted-foreground mt-0.5 leading-none">
                  {isLoggedIn ? userName : "Not signed in"}
                </p>
              </div>
            </div>
            <div className="flex items-center shrink-0">
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
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsOpen(false)}
                className="h-8 w-8 p-0 text-muted-foreground/50 hover:text-foreground touch-manipulation"
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
              <div
                ref={scrollRef}
                className="flex-1 overflow-y-auto overscroll-contain px-3 py-4 space-y-3 min-h-0"
                style={
                  { WebkitOverflowScrolling: "touch" } as React.CSSProperties
                }
              >
                {messages.map((m) => (
                  <div
                    key={m.id}
                    className={cn(
                      "flex",
                      m.cmdPill !== undefined
                        ? "justify-start"
                        : m.role === "user"
                          ? "justify-end"
                          : "justify-start",
                    )}
                  >
                    {m.content === "" &&
                    m.role === "assistant" &&
                    m.cmdPill === undefined ? (
                      <ThinkingBubble />
                    ) : (
                      <MessageBubble
                        content={m.content}
                        role={m.role}
                        cmdPill={m.cmdPill}
                        cmdState={m.cmdState}
                      />
                    )}
                  </div>
                ))}
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
                        "flex-1 text-sm bg-muted/40 border rounded-xl px-3 py-2 resize-none overflow-y-auto",
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
                  AI can be wrong.
                  {providerLabel ? (
                    <> Powered by {providerLabel}.</>
                  ) : (
                    " Responses are generated by a third-party model."
                  )}
                </p>
              </div>
            </>
          )}
        </div>
      )}

      {/* Trigger button */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className={cn(
            "fixed bottom-5 right-5 z-50",
            "h-12 w-12 rounded-full flex items-center justify-center",
            "bg-primary/15 border border-primary/30 text-primary",
            "hover:bg-primary/25 hover:border-primary/50",
            "shadow-lg shadow-black/20",
            "transition-all duration-150 active:scale-95 touch-manipulation",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
          )}
          aria-label="Open AI assistant"
        >
          <MessageCircle className="h-5 w-5" />
        </button>
      )}
    </>
  );
}
