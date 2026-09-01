import Link from "next/link";
import { ThemedLogo } from "@/components/shared/themed-logo";
import { APP_NAME, ROUTES } from "@/lib/config/client-constants";
import { cn } from "@/lib/ui/utils";
import { focus, transitions } from "@/lib/ui/animations";

interface AuthLayoutProps {
  children: React.ReactNode;
  /** `wide` is for the one screen that is a list rather than a form. */
  width?: "narrow" | "wide";
}

/**
 * Single-column shell for the screens a person lands on from an email link:
 * verify, unsubscribe, team invite. Same wordmark, same footer, same rhythm
 * as the split shell so the flow reads as one surface.
 */
export function AuthLayout({ children, width = "narrow" }: AuthLayoutProps) {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="px-5 sm:px-8 pt-6 pb-2 shrink-0">
        <AuthWordmark />
      </header>

      <main
        id="main-content"
        tabIndex={-1}
        className="flex-1 flex flex-col items-center justify-center px-5 sm:px-8 py-10"
      >
        <div
          className={cn(
            "w-full",
            width === "wide" ? "max-w-xl" : "max-w-sm",
            "motion-safe:animate-[fade-in_0.2s_ease-out_both]",
          )}
        >
          {children}
        </div>
      </main>

      <AuthFooter className="px-5 sm:px-8 pb-6 pt-2" />
    </div>
  );
}

export function AuthWordmark({ className }: { className?: string }) {
  return (
    <Link
      href="/"
      className={cn(
        "inline-flex items-center gap-2.5 group w-fit rounded-md",
        focus.ring,
        className,
      )}
    >
      <ThemedLogo
        width={26}
        height={26}
        className={cn(
          "h-[26px] w-[26px] shrink-0 motion-safe:group-hover:scale-105",
          transitions.transform,
        )}
        alt={`${APP_NAME} logo`}
      />
      <span className="text-lg font-semibold tracking-tight text-foreground">
        {APP_NAME}
      </span>
    </Link>
  );
}

export function AuthFooter({ className }: { className?: string }) {
  return (
    <footer
      className={cn(
        "shrink-0 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground/70",
        className,
      )}
    >
      <Link
        href={ROUTES.CONTACT}
        className={cn(
          "rounded hover:text-foreground",
          transitions.colors,
          focus.ring,
        )}
      >
        Locked out? Talk to a human
      </Link>
    </footer>
  );
}
