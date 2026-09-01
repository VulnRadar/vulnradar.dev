import { Globe } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";

export function PublicScansEmptyState() {
  return (
    <EmptyState
      icon={Globe}
      title="No public scans yet"
      description="Share a scan and list it publicly from the Shared page to be the first one here."
    />
  );
}
