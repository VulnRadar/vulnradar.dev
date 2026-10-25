import { AppPageShell } from "@/components/shared/app-page-shell";
import {
  ScanInspectorHeader,
  ScanInspectorSkeleton,
} from "@/components/admin/scans/scan-inspector";

/**
 * Without this file the segment inherited app/admin/loading.tsx, which draws
 * the admin console rather than one scan. Same shell and title block as the
 * page, so nothing moves when the data lands.
 */
export default function Loading() {
  return (
    <AppPageShell padding="py-8">
      <ScanInspectorHeader />
      <ScanInspectorSkeleton />
    </AppPageShell>
  );
}
