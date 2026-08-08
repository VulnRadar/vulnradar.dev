"use client";

import React from "react";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { TosModal } from "@/components/modals/tos-modal";
import { API } from "@/lib/config/constants";

const SKIP_TOS_PATHS = ["/login", "/signup", "/legal"];

export function TosGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [status, setStatus] = useState<
    "loading" | "accepted" | "pending" | "needs_reaccept" | "skip"
  >("loading");

  const shouldSkip = SKIP_TOS_PATHS.some((p) => pathname.startsWith(p));

  useEffect(() => {
    if (shouldSkip) {
      setStatus("skip");
      return;
    }

    async function check() {
      try {
        const res = await fetch(API.AUTH.ME);
        if (!res.ok) {
          // Not logged in - let middleware handle redirect
          setStatus("skip");
          return;
        }
        const data = await res.json();

        if (!data.tosAcceptedAt) {
          // Never accepted terms
          setStatus("pending");
          return;
        }

        // Compared against the runtime-configurable TERMS_UPDATED_AT setting
        // (returned by /api/v3/auth/me) rather than a build-time constant, so
        // an admin's edit to the terms date is picked up on the next check,
        // no rebuild required.
        const userAcceptedDate = new Date(data.tosAcceptedAt);
        const termsUpdatedDate = new Date(data.termsUpdatedAt);

        if (userAcceptedDate < termsUpdatedDate) {
          // User needs to re-accept updated terms
          setStatus("needs_reaccept");
        } else {
          setStatus("accepted");
        }
      } catch {
        setStatus("skip");
      }
    }

    check();
  }, [shouldSkip, pathname]);

  if (status === "loading") {
    return (
      <>
        {children}
        <div className="fixed inset-0 z-50" aria-hidden />
      </>
    );
  }

  if ((status === "pending" || status === "needs_reaccept") && !shouldSkip) {
    return (
      <>
        <div
          className="pointer-events-none select-none opacity-20 blur-sm"
          aria-hidden
        >
          {children}
        </div>
        <TosModal
          onAccept={() => setStatus("accepted")}
          isUpdate={status === "needs_reaccept"}
        />
      </>
    );
  }

  return <>{children}</>;
}
