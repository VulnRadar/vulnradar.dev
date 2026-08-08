"use client";

import { use, useEffect, useState } from "react";
import {
  ArrowLeft,
  Loader2,
  MessageCircle,
  ShieldOff,
  User,
  UserX,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Header } from "@/components/scanner/header";
import { Footer } from "@/components/scanner/footer";
import { UserAvatar } from "@/components/admin/shared";
import { MessageContent } from "@/components/ai-chat/message-content";
import { cn } from "@/lib/ui/utils";

interface PageProps {
  params: Promise<{ id: string }>;
}

type ConversationMessage = { role: "user" | "assistant"; content: string };

type ConversationDetail = {
  id: number;
  sessionId: string;
  userId: number | null;
  userName: string | null;
  userEmail: string | null;
  messages: ConversationMessage[];
  createdAt: string;
  lastMessageAt: string;
};

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function MessageBubble({ message }: { message: ConversationMessage }) {
  const isUser = message.role === "user";
  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[85%] sm:max-w-[70%] rounded-2xl px-4 py-3 text-sm leading-relaxed break-words",
          isUser
            ? "rounded-tr-sm bg-primary text-primary-foreground"
            : "rounded-tl-sm bg-muted/60 border border-border/30 text-foreground",
        )}
      >
        <MessageContent content={message.content} role={message.role} />
      </div>
    </div>
  );
}

export default function AdminConversationPage({ params }: PageProps) {
  const { id } = use(params);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [detail, setDetail] = useState<ConversationDetail | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setForbidden(false);
      setNotFound(false);
      try {
        const res = await fetch(`/api/v3/ai/conversations?id=${id}`);
        if (cancelled) return;
        if (res.status === 403) {
          setForbidden(true);
          return;
        }
        if (res.status === 404) {
          setNotFound(true);
          return;
        }
        if (!res.ok) {
          setNotFound(true);
          return;
        }
        const data = (await res.json()) as ConversationDetail;
        setDetail(data);
      } catch {
        if (!cancelled) setNotFound(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [id]);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header />
      <main className="flex-1 w-full max-w-4xl mx-auto px-4 sm:px-6 py-8">
        <div className="mb-6">
          <Button
            asChild
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 mb-3 border-border/60 bg-muted/40"
          >
            <a href="/admin?tab=ai-chats">
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
              Back to AI Chats
            </a>
          </Button>
          <h1 className="text-2xl font-semibold tracking-tight">Conversation</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Rendered with the same markdown and reasoning-block pipeline as
            the live chat widget.
          </p>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-24 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mr-2" aria-hidden="true" />
            Loading conversation...
          </div>
        )}

        {!loading && forbidden && (
          <div className="flex flex-col items-center gap-4 py-24 text-center">
            <div className="h-14 w-14 rounded-2xl bg-destructive/10 flex items-center justify-center">
              <ShieldOff className="h-7 w-7 text-destructive" aria-hidden="true" />
            </div>
            <div>
              <p className="text-lg font-semibold">Access Denied</p>
              <p className="text-sm text-muted-foreground mt-1 max-w-xs">
                You do not have staff privileges to view AI conversations.
              </p>
            </div>
          </div>
        )}

        {!loading && notFound && (
          <div className="flex flex-col items-center gap-4 py-24 text-center">
            <div className="h-14 w-14 rounded-2xl bg-muted flex items-center justify-center">
              <MessageCircle className="h-7 w-7 text-muted-foreground" aria-hidden="true" />
            </div>
            <div>
              <p className="text-lg font-semibold">Conversation not found</p>
              <p className="text-sm text-muted-foreground mt-1 max-w-xs">
                It may have expired and been cleaned up, or the id is wrong.
              </p>
            </div>
          </div>
        )}

        {!loading && detail && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center gap-4 p-4 rounded-xl border border-border/50 bg-card/50">
              <div className="flex items-center gap-3 flex-1 min-w-0">
                {detail.userId ? (
                  <UserAvatar
                    name={detail.userName}
                    email={detail.userEmail || `user-${detail.userId}`}
                  />
                ) : (
                  <div className="h-9 w-9 rounded-full bg-muted flex items-center justify-center shrink-0">
                    <UserX className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  </div>
                )}
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate flex items-center gap-1.5">
                    {detail.userName || detail.userEmail || (
                      <span className="inline-flex items-center gap-1 text-muted-foreground italic">
                        <User className="h-3 w-3" aria-hidden="true" />
                        Guest
                      </span>
                    )}
                  </p>
                  {detail.userEmail && (
                    <p className="text-xs text-muted-foreground truncate font-mono">
                      {detail.userEmail}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex flex-col gap-1 text-xs text-muted-foreground sm:text-right shrink-0">
                <span>
                  Started{" "}
                  <span className="text-foreground">
                    {formatDateTime(detail.createdAt)}
                  </span>
                </span>
                <span>
                  Last message{" "}
                  <span className="text-foreground">
                    {formatDateTime(detail.lastMessageAt)}
                  </span>
                </span>
                <span className="font-mono text-[11px]">
                  Session {detail.sessionId}
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-3">
              {detail.messages.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-12">
                  This conversation has no stored messages.
                </p>
              ) : (
                detail.messages.map((message, i) => (
                  <MessageBubble key={i} message={message} />
                ))
              )}
            </div>
          </div>
        )}
      </main>
      <Footer />
    </div>
  );
}
