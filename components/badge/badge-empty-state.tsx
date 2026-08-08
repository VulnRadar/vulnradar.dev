import Link from "next/link";
import { ShieldCheck, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ROUTES } from "@/lib/config/constants";

export function BadgeEmptyState() {
  return (
    <div className="rounded-xl border border-dashed border-border bg-card/30 py-14 px-6 text-center">
      <ShieldCheck
        className="h-8 w-8 text-muted-foreground/50 mx-auto mb-4"
        aria-hidden="true"
      />
      <p className="text-sm font-medium text-foreground mb-1">
        Nothing to badge yet
      </p>
      <p className="text-sm text-muted-foreground mb-6 max-w-xs mx-auto leading-relaxed">
        Badges are generated from a scan you already ran. Run one, then come
        back here to pick it.
      </p>
      <Button asChild size="sm" className="gap-1.5">
        <Link href={ROUTES.DASHBOARD}>
          Run a scan
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      </Button>
    </div>
  );
}
