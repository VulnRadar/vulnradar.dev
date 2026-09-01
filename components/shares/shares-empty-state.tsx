import Link from "next/link";
import { Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";

export function SharesEmptyState() {
  return (
    <EmptyState
      icon={Share2}
      title="Nothing shared yet"
      description="Open a scan in your history and hit Share to hand out a read-only link. Anyone with it sees the findings, no account required."
      action={
        <Button asChild size="sm">
          <Link href="/history">Go to history</Link>
        </Button>
      }
    />
  );
}
