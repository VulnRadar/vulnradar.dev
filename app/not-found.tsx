"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { Home, ArrowLeft } from "lucide-react";
import { ThemedLogo } from "@/components/shared/themed-logo";
import { Button } from "@/components/ui/button";
import { APP_NAME, ROUTES } from "@/lib/config/constants";
import { focus, transitions } from "@/lib/ui/animations";

export default function NotFound() {
  const router = useRouter();

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background px-4">
      <div className="w-full max-w-md flex flex-col items-center gap-8">
        <Link
          href={ROUTES.HOME}
          className={`flex items-center gap-2.5 rounded-sm ${transitions.default} ${focus.ring}`}
        >
          <ThemedLogo
            width={28}
            height={28}
            className="h-7 w-7"
            alt={`${APP_NAME} logo`}
          />
          <span className="text-xl font-mono font-semibold text-foreground tracking-tight">
            {APP_NAME}
          </span>
        </Link>

        <div className="flex flex-col items-center gap-3 text-center border-y border-border/50 py-8 w-full">
          <p className="font-mono text-6xl font-semibold text-foreground tabular-nums">
            404
          </p>
          <h1 className="text-lg font-semibold text-foreground">
            Nothing here
          </h1>
          <p className="text-sm text-muted-foreground leading-relaxed max-w-sm">
            That page does not exist, or moved. Nothing was scanned, nothing was
            lost.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 w-full">
          <Button asChild variant="default" className="flex-1 gap-2">
            <Link href={ROUTES.DASHBOARD}>
              <Home className="h-4 w-4" aria-hidden="true" />
              Go to Dashboard
            </Link>
          </Button>
          <Button
            variant="outline"
            className="flex-1 gap-2 bg-transparent"
            onClick={() => router.back()}
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Go back
          </Button>
        </div>

        <div className="flex gap-4 text-xs">
          <Link
            href={ROUTES.CONTACT}
            className={`text-primary hover:underline underline-offset-4 rounded-sm ${focus.ring}`}
          >
            Contact
          </Link>
          <span aria-hidden="true" className="text-muted-foreground">
            ·
          </span>
          <Link
            href={ROUTES.DOCS}
            className={`text-primary hover:underline underline-offset-4 rounded-sm ${focus.ring}`}
          >
            Documentation
          </Link>
          <span aria-hidden="true" className="text-muted-foreground">
            ·
          </span>
          <Link
            href={ROUTES.CHANGELOG}
            className={`text-primary hover:underline underline-offset-4 rounded-sm ${focus.ring}`}
          >
            Changelog
          </Link>
        </div>
      </div>
    </div>
  );
}
