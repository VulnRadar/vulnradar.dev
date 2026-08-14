"use client";

import React, { useState, useEffect } from "react";
import { Header } from "@/components/scanner/header";
import { Footer } from "@/components/scanner/footer";
import { LandingNav } from "@/components/landing/landing-nav";
import { useAuth } from "@/components/providers/auth-provider";

interface PublicPageShellProps {
  children: React.ReactNode;
  /** Label shown next to the logo for guests, e.g. "Staff", "Shared report" */
  badge?: string;
  /** Max-width class for the main content area. Defaults to "max-w-5xl" */
  maxWidth?: string;
  /** Extra padding class for main. Defaults to "py-8" */
  padding?: string;
}

// Check localStorage cache immediately to prevent header flash
function getInitialAuthState(): boolean | null {
  if (typeof window === "undefined") return null;
  try {
    const cached = localStorage.getItem("vr_auth_cache");
    if (cached) {
      const parsed = JSON.parse(cached);
      return !!parsed?.userId;
    }
  } catch {}
  return null;
}

export function PublicPageShell({
  children,
  badge,
  maxWidth = "max-w-5xl",
  padding = "py-8",
}: PublicPageShellProps) {
  const { me, isLoading } = useAuth();
  // Use localStorage cache for instant render, then sync with actual auth state
  const [cachedAuth, setCachedAuth] = useState<boolean | null>(() =>
    getInitialAuthState(),
  );

  // Once auth loads, use the real value
  useEffect(() => {
    if (!isLoading) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- snapshots the async auth-check result once loading completes, gated by isLoading transitioning
      setCachedAuth(!!me?.userId);
    }
  }, [me, isLoading]);

  // Show logged-in UI if either cache says yes OR real auth says yes
  // This prevents flash: cache loads instantly, real auth confirms later
  const isLoggedIn = cachedAuth === true || !!me?.userId;

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {isLoggedIn ? <Header /> : <LandingNav badge={badge} />}

      <main
        className={`flex-1 ${maxWidth} w-full mx-auto px-4 sm:px-6 ${padding}`}
      >
        {children}
      </main>

      <Footer />
    </div>
  );
}
