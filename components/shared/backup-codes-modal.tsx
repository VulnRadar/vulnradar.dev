"use client";

import { useCallback, useState } from "react";
import { usePathname } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ModalShell } from "@/components/ui/modal-shell";
import { PUBLIC_PATHS } from "@/lib/config/public-paths";
import { useAuth } from "@/components/providers/auth-provider";
import { ROUTES } from "@/lib/config/client-constants";

/**
 * Full-screen reminder for an account whose stored 2FA backup codes cannot be
 * verified any more (an unparseable or pre-hashing value).
 *
 * Mounted through backup-codes-mount.tsx, which imports this file only for an
 * account that has the problem. It lived at the bottom of notification-center
 * until then, which meant the bell's module was in the root layout's graph for
 * the sake of one modal almost nobody sees.
 */
export function BackupCodesModal() {
  const pathname = usePathname();
  const [dismissed, setDismissed] = useState(false);
  const { me } = useAuth();

  const isPublicRoute = PUBLIC_PATHS.some((p) => {
    if (p === "/" || p === "/landing") return pathname === p;
    return pathname.startsWith(p);
  });

  const show = Boolean(
    !isPublicRoute && me?.userId && me?.backupCodesInvalid && !dismissed,
  );

  // Was a `closing` flag plus a 200ms setTimeout driving an exit animation on
  // a hand-rolled scrim. ModalShell unmounts on close like every other modal
  // in the app, so the flag had nothing left to animate.
  const handleDismiss = useCallback(() => setDismissed(true), []);

  // The full-bleed destructive rail, the "Security Alert" eyebrow and the
  // centred icon plate are gone: the header band's own mark carries the
  // destructive tone, and none of the three exist on any other modal.
  return (
    <ModalShell
      open={show}
      onClose={handleDismiss}
      title="Backup codes need rotation"
      description="We upgraded our security to hash all 2FA backup codes. Your old codes stopped working. Generate a new set from your security settings."
      icon={
        <AlertTriangle
          className="h-4 w-4 shrink-0 text-destructive"
          aria-hidden="true"
        />
      }
      size="md"
      footer={
        <>
          <Button
            variant="outline"
            size="sm"
            className="bg-transparent"
            onClick={handleDismiss}
          >
            Remind me later
          </Button>
          <Button size="sm" asChild>
            <a href={`${ROUTES.PROFILE}?tab=security`} onClick={handleDismiss}>
              Rotate backup codes
            </a>
          </Button>
        </>
      }
    >
      <div className="rounded-lg bg-destructive/5 border border-destructive/20 px-3 py-2.5">
        <p className="text-xs text-destructive font-medium">
          Until you regenerate, backup codes cannot get you back in if you lose
          your authenticator app.
        </p>
      </div>
    </ModalShell>
  );
}
