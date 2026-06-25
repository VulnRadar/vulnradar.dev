import { ShieldX, RotateCcw, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import Link from "next/link";

interface DashboardErrorStateProps {
  error: string;
  details?: string;
  onRetry: () => void;
}

export function DashboardErrorState({
  error,
  details,
  onRetry,
}: DashboardErrorStateProps) {
  const isBlocked = error === "This target cannot be scanned.";

  return (
    <div className="flex flex-col items-center gap-5 py-12 px-4 text-center">
      <div className="flex items-center justify-center w-14 h-14 rounded-2xl bg-destructive/10">
        <ShieldX className="h-7 w-7 text-destructive" />
      </div>

      <div className="flex flex-col items-center gap-2 max-w-md">
        <p className="text-xs font-medium text-primary uppercase tracking-wider">
          Scan
        </p>
        <h2 className="text-xl font-semibold text-foreground">
          {isBlocked ? "Target restricted" : "Scan failed"}
        </h2>
        <p className="text-sm text-muted-foreground leading-relaxed text-pretty">
          {error}
        </p>
      </div>

      {details && (
        <div className="w-full max-w-md p-4 rounded-xl border border-border/50 bg-card/50 text-left">
          <p className="text-xs text-muted-foreground leading-relaxed break-words">
            {details}
          </p>
        </div>
      )}

      {isBlocked && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Mail className="h-3.5 w-3.5 shrink-0" />
          <span>
            Questions? Contact{" "}
            <Link
              href="mailto:support@vulnradar.dev"
              className="text-primary hover:underline"
            >
              support@vulnradar.dev
            </Link>
          </span>
        </div>
      )}

      <Button variant="outline" onClick={onRetry} className="bg-transparent">
        <RotateCcw className="mr-2 h-4 w-4" />
        Try again
      </Button>
    </div>
  );
}
