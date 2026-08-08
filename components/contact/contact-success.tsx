import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { APP_NAME, ROUTES } from "@/lib/config/constants";

interface ContactSuccessProps {
  category: string | null;
  onReset: () => void;
}

export function ContactSuccess({ category, onReset }: ContactSuccessProps) {
  return (
    <div className="rounded-xl border border-border/50 bg-card/50 py-14 px-6 flex flex-col items-center gap-4 text-center">
      <CheckCircle2
        className="h-9 w-9 text-[hsl(var(--success))]"
        aria-hidden="true"
      />
      <div>
        <h2 className="text-lg font-semibold text-foreground">Message sent</h2>
        <p className="text-sm text-muted-foreground mt-1 max-w-sm leading-relaxed">
          {category === "security"
            ? "We'll review the report and follow up on the resolution."
            : "We'll get back to you as soon as we can."}
        </p>
      </div>
      <div className="flex gap-3 mt-2">
        <Button variant="outline" onClick={onReset}>
          Send another
        </Button>
        <Link href={ROUTES.HOME}>
          <Button>Back to {APP_NAME}</Button>
        </Link>
      </div>
    </div>
  );
}
