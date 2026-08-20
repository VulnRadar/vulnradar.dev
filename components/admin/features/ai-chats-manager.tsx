"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import {
  MessageCircle,
  User,
  UserX,
  Users,
  Search,
  RefreshCw,
  ArrowUpRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PaginationControl } from "@/components/ui/pagination-control";
import { cn } from "@/lib/ui/utils";
import {
  DataTableSkeleton,
  EmptyState,
  StatBar,
  StatBarSkeleton,
  SortableHeader,
  TableScrollArea,
  UserAvatar,
  nextSortDirection,
  type SortDirection,
} from "@/components/admin/shared";
import { formatRelativeTime } from "@/components/admin/utils";

type Conversation = {
  id: number;
  sessionId: string;
  userId: number | null;
  userName: string | null;
  userEmail: string | null;
  userAvatarUrl: string | null;
  messageCount: number;
  createdAt: string;
  lastMessageAt: string;
};

type IdentityFilter = "all" | "signed-in" | "guest";
type SortColumn = "messages" | "activity";

/**
 * List/overview of stored AI chat conversations. Each row links out to the
 * dedicated conversation page (app/admin/ai-chats/[id]/page.tsx), which is
 * where messages actually get rendered through the same pipeline as the
 * live chat widget. This view only ever shows metadata the list endpoint
 * returns (no message content), so search/sort/identity counts below are
 * scoped to the page currently loaded, the same way other admin stat bars
 * in this codebase summarize whatever is currently fetched rather than the
 * whole table.
 */
export function AIChatsManager() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [identityFilter, setIdentityFilter] = useState<IdentityFilter>("all");
  const [sortColumn, setSortColumn] = useState<SortColumn | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>(null);

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
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount/page-change: fetchConversations' setState calls only fire after its async request resolves, not synchronously in this effect
    fetchConversations(page, pageSize);
  }, [page, pageSize, fetchConversations]);

  const totalPages = Math.ceil(total / pageSize);

  const signedInCount = useMemo(
    () => conversations.filter((c) => c.userId !== null).length,
    [conversations],
  );
  const guestCount = conversations.length - signedInCount;
  const messageCountOnPage = useMemo(
    () => conversations.reduce((sum, c) => sum + c.messageCount, 0),
    [conversations],
  );

  const visibleConversations = useMemo(() => {
    let rows = conversations;
    if (identityFilter === "signed-in")
      rows = rows.filter((c) => c.userId !== null);
    else if (identityFilter === "guest")
      rows = rows.filter((c) => c.userId === null);
    const term = search.trim().toLowerCase();
    if (term) {
      rows = rows.filter(
        (c) =>
          c.userName?.toLowerCase().includes(term) ||
          c.userEmail?.toLowerCase().includes(term) ||
          c.sessionId.toLowerCase().includes(term),
      );
    }
    if (sortColumn && sortDirection) {
      const dir = sortDirection === "asc" ? 1 : -1;
      rows = [...rows].sort((a, b) => {
        if (sortColumn === "messages")
          return (a.messageCount - b.messageCount) * dir;
        return (
          (new Date(a.lastMessageAt).getTime() -
            new Date(b.lastMessageAt).getTime()) *
          dir
        );
      });
    }
    return rows;
  }, [conversations, identityFilter, search, sortColumn, sortDirection]);

  const handleSort = (column: SortColumn) => {
    const next = nextSortDirection(column, sortColumn, sortDirection);
    setSortColumn(next.column as SortColumn | null);
    setSortDirection(next.direction);
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">
          AI Conversations
        </h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          Stored chat sessions from the support widget. Open one to read it
          rendered the same way the widget shows it.
        </p>
      </div>

      {loading && conversations.length === 0 ? (
        <StatBarSkeleton segments={4} />
      ) : (
        <StatBar
          items={[
            {
              label: "All (this page)",
              value: conversations.length,
              icon: Users,
              tone: "success",
              onClick: () => setIdentityFilter("all"),
              active: identityFilter === "all",
            },
            {
              label: "Signed-in",
              value: signedInCount,
              icon: User,
              tone: "primary",
              onClick: () => setIdentityFilter("signed-in"),
              active: identityFilter === "signed-in",
            },
            {
              label: "Guests",
              value: guestCount,
              icon: UserX,
              tone: "muted",
              onClick: () => setIdentityFilter("guest"),
              active: identityFilter === "guest",
            },
            {
              label: "Messages (this page)",
              value: messageCountOnPage,
              icon: MessageCircle,
              tone: "purple",
            },
          ]}
        />
      )}

      <Card className="border-border/50 bg-card/50 overflow-hidden">
        <CardHeader className="pb-4 pt-5 px-5">
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="p-2 rounded-lg bg-primary/10 shrink-0">
                  <MessageCircle
                    className="h-4 w-4 text-primary"
                    aria-hidden="true"
                  />
                </div>
                <div className="min-w-0">
                  <CardTitle className="text-base font-semibold truncate">
                    Conversations
                  </CardTitle>
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">
                    {total} conversation{total !== 1 ? "s" : ""} stored
                  </p>
                </div>
              </div>
              <Badge
                variant="secondary"
                className="text-xs font-medium h-6 px-2.5 shrink-0"
              >
                {total.toLocaleString()} total
              </Badge>
            </div>
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="relative flex-1">
                <Search
                  className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none"
                  aria-hidden="true"
                />
                <Input
                  placeholder="Search this page by name, email, or session id..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  aria-label="Search conversations on this page"
                  className="pl-9 h-10 bg-background/50 border-border/40 focus:border-primary/50"
                />
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-10 px-3 gap-2 border-border/40 shrink-0"
                onClick={() => fetchConversations(page, pageSize)}
                aria-label="Refresh conversations"
              >
                <RefreshCw
                  className={cn("h-4 w-4", loading && "animate-spin")}
                  aria-hidden="true"
                />
                <span className="hidden sm:inline">Refresh</span>
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {loading ? (
            <div className="p-4 sm:p-5">
              <DataTableSkeleton rows={6} />
            </div>
          ) : conversations.length === 0 ? (
            <EmptyState
              icon={MessageCircle}
              title="No conversations yet"
              description="AI chat sessions will appear here when users interact with the widget."
            />
          ) : visibleConversations.length === 0 ? (
            <EmptyState
              icon={Search}
              title="No conversations match"
              description="Try a different search term or filter."
            />
          ) : (
            <>
              {/* Desktop table */}
              <div className="hidden md:block">
                <TableScrollArea maxHeight="65vh">
                  <Table>
                    <TableHeader className="sticky top-0 z-10 bg-muted/95 backdrop-blur-sm supports-backdrop-filter:bg-muted/90">
                      <TableRow className="border-y border-border/50 hover:bg-transparent">
                        <TableHead className="px-5 h-10 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                          User
                        </TableHead>
                        <TableHead className="px-4 h-10 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                          Session
                        </TableHead>
                        <TableHead className="px-4 h-10">
                          <SortableHeader
                            label="Messages"
                            active={sortColumn === "messages"}
                            direction={
                              sortColumn === "messages" ? sortDirection : null
                            }
                            onClick={() => handleSort("messages")}
                          />
                        </TableHead>
                        <TableHead className="px-4 h-10">
                          <SortableHeader
                            label="Last Active"
                            active={sortColumn === "activity"}
                            direction={
                              sortColumn === "activity" ? sortDirection : null
                            }
                            onClick={() => handleSort("activity")}
                          />
                        </TableHead>
                        <TableHead className="px-5 h-10 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                          Actions
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {visibleConversations.map((conv) => (
                        <TableRow
                          key={conv.id}
                          className="border-border/40 group"
                        >
                          <TableCell className="px-5 py-3">
                            <div className="flex items-center gap-3">
                              {conv.userId ? (
                                <UserAvatar
                                  name={conv.userName}
                                  email={
                                    conv.userEmail || `user-${conv.userId}`
                                  }
                                  avatarUrl={conv.userAvatarUrl}
                                  size="sm"
                                />
                              ) : (
                                <div className="h-7 w-7 rounded-full bg-muted flex items-center justify-center shrink-0">
                                  <UserX
                                    className="h-3.5 w-3.5 text-muted-foreground"
                                    aria-hidden="true"
                                  />
                                </div>
                              )}
                              <div className="min-w-0">
                                {conv.userName || conv.userEmail ? (
                                  <>
                                    <p className="text-sm font-medium truncate">
                                      {conv.userName || conv.userEmail}
                                    </p>
                                    {conv.userEmail && conv.userName && (
                                      <p className="text-xs text-muted-foreground truncate font-mono">
                                        {conv.userEmail}
                                      </p>
                                    )}
                                  </>
                                ) : (
                                  <Badge
                                    variant="outline"
                                    className="text-[10px] px-1.5 py-0 font-normal text-muted-foreground border-border/50"
                                  >
                                    Guest
                                  </Badge>
                                )}
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="px-4 py-3">
                            <span className="text-xs font-mono text-muted-foreground truncate block max-w-40">
                              {conv.sessionId}
                            </span>
                          </TableCell>
                          <TableCell className="px-4 py-3">
                            <span className="text-sm font-medium text-foreground">
                              {conv.messageCount}
                            </span>
                          </TableCell>
                          <TableCell className="px-4 py-3 text-sm text-muted-foreground whitespace-nowrap">
                            {formatRelativeTime(new Date(conv.lastMessageAt))}
                          </TableCell>
                          <TableCell className="px-5 py-3">
                            <div className="flex items-center justify-end">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 gap-1.5"
                                asChild
                              >
                                <Link href={`/admin/ai-chats/${conv.id}`}>
                                  <span className="text-xs">View</span>
                                  <ArrowUpRight
                                    className="h-3.5 w-3.5"
                                    aria-hidden="true"
                                  />
                                </Link>
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableScrollArea>
              </div>

              {/* Mobile list */}
              <div className="md:hidden flex flex-col">
                {visibleConversations.map((conv) => (
                  <Link
                    key={conv.id}
                    href={`/admin/ai-chats/${conv.id}`}
                    className="flex items-center gap-3 px-5 py-4 border-b border-border/40 last:border-0 hover:bg-muted/20 transition-colors"
                  >
                    {conv.userId ? (
                      <UserAvatar
                        name={conv.userName}
                        email={conv.userEmail || `user-${conv.userId}`}
                        avatarUrl={conv.userAvatarUrl}
                        size="sm"
                      />
                    ) : (
                      <div className="h-7 w-7 rounded-full bg-muted flex items-center justify-center shrink-0">
                        <UserX
                          className="h-3.5 w-3.5 text-muted-foreground"
                          aria-hidden="true"
                        />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {conv.userName || conv.userEmail || "Guest"}
                      </p>
                      <div className="flex items-center gap-3 mt-0.5 text-[11px] text-muted-foreground">
                        <span>{conv.messageCount} messages</span>
                        <span className="text-border">|</span>
                        <span>
                          {formatRelativeTime(new Date(conv.lastMessageAt))}
                        </span>
                      </div>
                    </div>
                    <ArrowUpRight
                      className="h-4 w-4 text-muted-foreground/50 shrink-0"
                      aria-hidden="true"
                    />
                  </Link>
                ))}
              </div>

              {totalPages > 1 && (
                <div className="px-5 py-4 border-t border-border/40 bg-muted/20">
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
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
