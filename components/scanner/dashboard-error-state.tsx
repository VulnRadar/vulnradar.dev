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
    <div className="flex flex-col items-center gap-6 py-12 px-4">
      <div className="flex items-center justify-center w-14 h-14 rounded-2xl bg-destructive/10">
        <ShieldX className="h-7 w-7 text-destructive" />
      </div>

      <div className="flex flex-col items-center gap-3 text-center max-w-md">
        <h2 className="text-lg font-semibold text-foreground">
          {isBlocked ? "Target Restricted" : "Scan Failed"}
        </h2>
        <p className="text-sm text-muted-foreground leading-relaxed">{error}</p>

        {details && (
          <div className="mt-2 p-4 rounded-xl border border-border/50 bg-card/50 text-left">
            <p className="text-xs text-muted-foreground leading-relaxed">
              {details}
            </p>
          </div>
        )}

        {isBlocked && (
          <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
            <Mail className="h-3.5 w-3.5" />
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
      </div>

      <Button variant="outline" onClick={onRetry} className="bg-transparent">
        <RotateCcw className="mr-2 h-4 w-4" />
        Try Again
      </Button>
    </div>
  );
}
