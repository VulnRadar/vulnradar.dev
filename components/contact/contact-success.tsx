import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";
import { APP_NAME, ROUTES } from "@/lib/config/constants";

interface ContactSuccessProps {
  category: string | null;
  onReset: () => void;
}

/**
 * Rebuilt on components/shared/empty-state, which this was a hand-copy of down
 * to the same py-14: mark, title, description, actions, in that order. Toned
 * "success" because it is a verdict about what the user just did, not a report
 * that a list is empty, which is exactly the distinction that component draws.
 */
export function ContactSuccess({ category, onReset }: ContactSuccessProps) {
  return (
    <EmptyState
      icon={CheckCircle2}
      tone="success"
      title="Message sent"
      description={
        category === "security"
          ? "We'll review the report and follow up on the resolution."
          : "We'll get back to you as soon as we can."
      }
      action={
        // One grammar for both buttons. The second used to be a <Link> wrapped
        // around a <Button>, which renders an anchor around a button element.
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Button variant="outline" onClick={onReset}>
            Send another
          </Button>
          <Button asChild>
            <Link href={ROUTES.HOME}>Back to {APP_NAME}</Link>
          </Button>
        </div>
      }
    />
  );
}
