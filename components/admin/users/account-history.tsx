"use client";

import { useEffect, useState } from "react";
import { History } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ActionBadge } from "@/components/admin/shared";
import { EmptyState } from "@/components/shared/empty-state";
import {
  formatRelativeTime,
  getActionSentence,
} from "@/components/admin/utils";
import type { AuditEntry } from "@/components/admin/types";
import { API, ROUTES } from "@/lib/config/client-constants";

/** Enough to see the last few things staff did, not a second audit log. */
const HISTORY_ROWS = 8;

/**
 * Everything staff have done to this account, newest first.
 *
 * "What has staff done to this account" had no answer in the panel: the audit
 * log filtered the ten rows on the page it happened to be showing. The server
 * can now filter the whole log by target, so this asks it. The entry that
 * opening this panel wrote (a view of the account record) is in the list,
 * which is correct: it is something staff did to the account.
 *
 * Rendered only for a role holding VIEW_AUDIT_LOG, the grant section=audit
 * enforces.
 */
export function AccountHistory({ userId }: { userId: number }) {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [total, setTotal] = useState(0);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setEntries(null);
      setFailed(false);
      try {
        const res = await fetch(
          `${API.ADMIN}?section=audit&targetUserId=${userId}&limit=${HISTORY_ROWS}`,
        );
        if (cancelled) return;
        if (!res.ok) {
          setFailed(true);
          return;
        }
        const data = (await res.json()) as {
          logs?: AuditEntry[];
          total?: number;
        };
        setEntries(Array.isArray(data.logs) ? data.logs : []);
        setTotal(Number(data.total) || 0);
      } catch {
        if (!cancelled) setFailed(true);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  return (
    <Card id="account-history" className="border-border/50 bg-card/50">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <History className="h-4 w-4 text-primary" aria-hidden="true" />
          <p className="text-sm font-medium">Account history</p>
          <Badge variant="secondary" className="text-[11px] h-5 ml-auto">
            {total}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="p-4 pt-0">
        {failed ? (
          <EmptyState
            icon={History}
            tone="error"
            variant="inline"
            size="sm"
            title="Couldn't load the history"
          />
        ) : entries === null ? (
          <div className="space-y-2" aria-hidden="true">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        ) : entries.length === 0 ? (
          <EmptyState
            icon={History}
            variant="inline"
            size="sm"
            title="Nothing has been done to this account"
          />
        ) : (
          <>
            <ul className="flex flex-col">
              {entries.map((entry) => (
                <li
                  key={entry.id}
                  className="flex items-center gap-3 border-b border-border/50 px-2 py-2.5 last:border-0"
                >
                  <ActionBadge action={entry.action} />
                  <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                    {getActionSentence(entry)}
                  </p>
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {formatRelativeTime(new Date(entry.created_at))}
                  </span>
                </li>
              ))}
            </ul>
            {total > entries.length && (
              <a
                href={`${ROUTES.ADMIN}?tab=audit&targetUserId=${userId}`}
                className="mt-2 inline-block rounded-sm px-2 py-1.5 text-xs text-primary hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
              >
                See all {total.toLocaleString()} in the audit log
              </a>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
