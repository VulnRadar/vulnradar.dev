import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { SkeletonRegion } from "@/components/shared/skeleton-shapes";
import { ROUTES } from "@/lib/config/client-constants";

/*
 * No "use client", on purpose. app/admin/scans/[id]/loading.tsx draws these two
 * and nothing else, and it used to import them from scan-inspector.tsx: a
 * client module holding the fetch, the status pill, the severity badges and the
 * admin shared barrel. A route fallback that arrives before the page exists
 * should cost the page's skeleton, not its code. Both pieces here are plain
 * markup, so the fallback renders on the server and ships no JavaScript.
 */

/**
 * The title block, with no data in it so the route fallback and the page draw
 * the same element instead of two copies that can disagree.
 */
export function ScanInspectorHeader() {
  return (
    <div className="mb-6">
      <Button
        asChild
        variant="outline"
        size="sm"
        className="h-8 gap-1.5 mb-3 border-border/60 bg-muted/40"
      >
        <Link href={ROUTES.ADMIN}>
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          Back to admin
        </Link>
      </Button>
      <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-balance text-foreground">
        Scan inspector
      </h1>
      <p className="text-sm text-muted-foreground mt-1">
        The stored row, including the raw error the owner is never shown. Each
        read is recorded in the audit log.
      </p>
    </div>
  );
}

export function ScanInspectorSkeleton() {
  return (
    <SkeletonRegion label="Loading scan">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="space-y-6">
          <Skeleton className="h-40 w-full rounded-xl" />
          <Skeleton className="h-72 w-full rounded-xl" />
        </div>
        <Skeleton className="h-96 w-full rounded-xl" />
      </div>
    </SkeletonRegion>
  );
}
