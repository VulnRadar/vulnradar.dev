"use client";

import { useState, useEffect, useCallback } from "react";
import { Loader2, ChevronRight, ChevronDown, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PaginationControl } from "@/components/ui/pagination-control";
import { cn } from "@/lib/ui/utils";

type Conversation = {
  id: number;
  sessionId: string;
  userId: number | null;
  userName: string | null;
  userEmail: string | null;
  messageCount: number;
  createdAt: string;
  lastMessageAt: string;
};

type Message = {
  role: "user" | "assistant";
  content: string;
};

type ConversationDetail = Conversation & { messages: Message[] };

function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function MessageRow({ msg }: { msg: Message }) {
  return (
    <div
      className={cn(
        "text-sm px-3 py-2 rounded-lg max-w-[85%] whitespace-pre-wrap break-words",
        msg.role === "user"
          ? "bg-primary/10 text-foreground self-end ml-auto"
          : "bg-muted/60 text-foreground border border-border/30",
      )}
    >
      {msg.content}
    </div>
  );
}

function ConversationRow({
  conv,
  isExpanded,
  detail,
  loadingDetail,
  onToggle,
}: {
  conv: Conversation;
  isExpanded: boolean;
  detail: ConversationDetail | null;
  loadingDetail: boolean;
  onToggle: (id: number) => void;
}) {
  return (
    <div className="border border-border/40 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => onToggle(conv.id)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors text-left"
      >
        <div className="shrink-0 text-muted-foreground/50">
          {isExpanded ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {conv.userName || conv.userEmail ? (
              <span className="text-sm font-medium text-foreground truncate">
                {conv.userName || conv.userEmail}
              </span>
            ) : (
              <span className="text-sm text-muted-foreground italic flex items-center gap-1">
                <User className="h-3 w-3" />
                Guest
              </span>
            )}
            {conv.userEmail && conv.userName && (
              <span className="text-xs text-muted-foreground truncate">
                {conv.userEmail}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-0.5">
            <span className="text-xs text-muted-foreground">
              {formatDate(conv.lastMessageAt)}
            </span>
            <span className="text-xs text-muted-foreground">
              {conv.messageCount} message{conv.messageCount !== 1 ? "s" : ""}
            </span>
          </div>
        </div>
      </button>

      {isExpanded && (
        <div className="border-t border-border/30 bg-muted/10 px-4 py-4">
          {loadingDetail ? (
            <div className="flex items-center gap-2 py-4 justify-center">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Loading...</span>
            </div>
          ) : detail ? (
            <div className="flex flex-col gap-2">
              {detail.messages.map((msg, i) => (
                <MessageRow key={i} msg={msg} />
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-4">
              Could not load messages.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export function AIChatsManager() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [detailMap, setDetailMap] = useState<
    Record<number, ConversationDetail>
  >({});
  const [loadingDetail, setLoadingDetail] = useState<number | null>(null);

  const fetchConversations = useCallback(async (p: number, limit: number) => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/v3/ai/conversations?page=${p}&limit=${limit}`,
      );
      if (!res.ok) return;
      const data = (await res.json()) as {
        conversations: Conversation[];
        total: number;
        page: number;
        limit: number;
      };
      setConversations(data.conversations);
      setTotal(data.total);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConversations(page, pageSize);
  }, [page, pageSize, fetchConversations]);

  const handleToggle = useCallback(
    async (id: number) => {
      if (expandedId === id) {
        setExpandedId(null);
        return;
      }
      setExpandedId(id);
      if (detailMap[id]) return;
      setLoadingDetail(id);
      try {
        const res = await fetch(`/api/v3/ai/conversations?id=${id}`);
        if (!res.ok) return;
        const data = (await res.json()) as ConversationDetail;
        setDetailMap((prev) => ({ ...prev, [id]: data }));
      } catch {
        // ignore
      } finally {
        setLoadingDetail(null);
      }
    },
    [expandedId, detailMap],
  );

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">
          AI Conversations
        </h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          {total} conversation{total !== 1 ? "s" : ""} stored
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 gap-2">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
          <span className="text-sm text-muted-foreground">Loading...</span>
        </div>
      ) : conversations.length === 0 ? (
        <div className="py-16 text-center rounded-xl border border-dashed border-border/60">
          <p className="text-sm font-semibold text-foreground">
            No conversations yet
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            AI chat sessions will appear here when users interact with the
            widget.
          </p>
        </div>
      ) : (
        <>
          <div className="space-y-2">
            {conversations.map((conv) => (
              <ConversationRow
                key={conv.id}
                conv={conv}
                isExpanded={expandedId === conv.id}
                detail={detailMap[conv.id] || null}
                loadingDetail={loadingDetail === conv.id}
                onToggle={handleToggle}
              />
            ))}
          </div>
          {totalPages > 1 && (
            <PaginationControl
              currentPage={page}
              totalPages={totalPages}
              onPageChange={setPage}
              pageSize={pageSize}
              onPageSizeChange={(s) => {
                setPageSize(s);
                setPage(1);
              }}
              totalItems={total}
            />
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchConversations(page, pageSize)}
            className="gap-1.5"
          >
            Refresh
          </Button>
        </>
      )}
    </div>
  );
}
