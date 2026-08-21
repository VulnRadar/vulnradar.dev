"use client";

import { X, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PaginationControl } from "@/components/ui/pagination-control";
import {
  type Member,
  type MemberScan,
  formatRelativeTime,
} from "./teams-types";

interface TeamMemberScansProps {
  member: Member;
  scans: MemberScan[];
  loading: boolean;
  page: number;
  pageSize: number;
  totalPages: number;
  paginatedScans: MemberScan[];
  onClose: () => void;
  onPageChange: (p: number) => void;
  onPageSizeChange: (s: number) => void;
}

export function TeamMemberScans({
  member,
  scans,
  loading,
  page,
  pageSize,
  totalPages,
  paginatedScans,
  onClose,
  onPageChange,
  onPageSizeChange,
}: TeamMemberScansProps) {
  return (
    <Card className="bg-card border-border/50">
      <CardContent className="p-0">
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-border">
          <div className="min-w-0">
            <p className="text-sm font-medium truncate">
              {member.name || member.email}&apos;s Scan History
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {scans.length} scan{scans.length !== 1 && "s"} total
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0 shrink-0"
            onClick={onClose}
            aria-label="Close member scans"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {loading ? (
          <div
            className="divide-y divide-border"
            role="status"
            aria-live="polite"
            aria-label="Loading scans"
          >
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-5 py-3">
                <div className="flex-1 min-w-0 space-y-1.5">
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-3 w-32" />
                </div>
                <Skeleton className="h-8 w-16 rounded-md shrink-0" />
              </div>
            ))}
          </div>
        ) : scans.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-sm text-muted-foreground">No scans found</p>
          </div>
        ) : (
          <>
            <div className="divide-y divide-border">
              {paginatedScans.map((scan) => (
                <div
                  key={scan.id}
                  className="flex items-center gap-3 px-5 py-3 hover:bg-muted/30 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate font-mono">
                      {scan.url}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatRelativeTime(new Date(scan.scanned_at))} ·{" "}
                      {scan.findings_count} issue
                      {scan.findings_count !== 1 && "s"}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-1.5 shrink-0"
                    asChild
                  >
                    <a href={`/history#${scan.id}`}>
                      View
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </Button>
                </div>
              ))}
            </div>
            <div className="p-4 border-t border-border">
              <PaginationControl
                currentPage={page}
                totalPages={totalPages}
                onPageChange={onPageChange}
                pageSize={pageSize}
                onPageSizeChange={(s) => {
                  onPageSizeChange(s);
                  onPageChange(1);
                }}
                totalItems={scans.length}
              />
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
