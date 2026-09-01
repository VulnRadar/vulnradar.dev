"use client";

import React from "react";
import { useState } from "react";
import { usePathname } from "next/navigation";
import { TosModal } from "@/components/modals/tos-modal";
import { useAuth } from "@/components/providers/auth-provider";

// Paths the terms modal must never cover. Beyond the auth entry points, these
// are the flows a signed-in account with pending or needs_reaccept status still
// has to be able to complete: the unsubscribe link in every marketing email,
// email verification, and password recovery. Blurring those behind a blocking
// modal made the unsubscribe link in outgoing mail unusable, which is a
// compliance problem and not just an inconvenience.
const SKIP_TOS_PATHS = [
  "/login",
  "/signup",
  "/legal",
  "/unsubscribe",
  "/verify-email",
  "/reset-password",
  "/forgot-password",
];

export function TosGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // This wraps every page in the root layout, and it used to issue its own
  // raw fetch(API.AUTH.ME) on every navigation that was not skipped. That is
  // the exact call AuthProvider (its own parent) already makes and caches, so
  // every page load spent two requests answering one question. MeResponse has
  // carried tosAcceptedAt and termsUpdatedAt for this purpose all along; the
  // gate just never switched over to reading them.
  const { me, isLoading } = useAuth();
  /** Set by the modal's own accept, so the gate lifts without waiting for
   *  the /auth/me cache to be revalidated. */
  const [acceptedNow, setAcceptedNow] = useState(false);

  const shouldSkip = SKIP_TOS_PATHS.some((p) => pathname.startsWith(p));

  const status: "loading" | "accepted" | "pending" | "needs_reaccept" | "skip" =
    (() => {
      if (shouldSkip) return "skip";
      if (acceptedNow) return "accepted";
      if (isLoading) return "loading";
      // Signed out: middleware owns the redirect, this gate has nothing to
      // say. Also covers a failed /auth/me, which must not blur the page.
      if (!me?.userId) return "skip";
      if (!me.tosAcceptedAt) return "pending";
      // Compared against the runtime-configurable TERMS_UPDATED_AT setting
      // (returned by /api/v3/auth/me) rather than a build-time constant, so
      // an admin's edit to the terms date is picked up on the next check,
      // no rebuild required.
      if (!me.termsUpdatedAt) return "accepted";
      return new Date(me.tosAcceptedAt) < new Date(me.termsUpdatedAt)
        ? "needs_reaccept"
        : "accepted";
    })();

  if (status === "loading") {
    return (
      <>
        {children}
        {/* Decorative-only during the brief /auth/me check. pointer-events-none
            so it never swallows clicks/scroll on the app rendered behind it --
            without it the page looks ready but eats all input until the check
            resolves (and forever if it hangs). The real ToS gate is the modal
            below once the status is known. */}
        <div className="pointer-events-none fixed inset-0 z-50" aria-hidden />
      </>
    );
  }

  if ((status === "pending" || status === "needs_reaccept") && !shouldSkip) {
    return (
      <>
        <div
          className="pointer-events-none select-none opacity-20 blur-xs"
          aria-hidden
        >
          {children}
        </div>
        <TosModal
          onAccept={() => setAcceptedNow(true)}
          isUpdate={status === "needs_reaccept"}
        />
      </>
    );
  }

  return <>{children}</>;
}
