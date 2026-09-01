import Link from "next/link";
import { ShieldCheck, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";
import { ROUTES } from "@/lib/config/client-constants";

export function BadgeEmptyState() {
  return (
    <EmptyState
      icon={ShieldCheck}
      title="Nothing to badge yet"
      description="Badges are generated from a scan you already ran. Run one, then come back here to pick it."
      action={
        <Button asChild size="sm" className="gap-1.5">
          <Link href={ROUTES.DASHBOARD}>
            Run a scan
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        </Button>
      }
    />
  );
}
