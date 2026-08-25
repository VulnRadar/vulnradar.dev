"use client";

import React from "react";
import { LandingNav } from "@/components/landing/landing-nav";
import { Footer } from "@/components/scanner/footer";

export function DemoShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col bg-background overflow-x-hidden">
      <LandingNav />
      <main id="main-content" tabIndex={-1} className="flex-1 min-w-0">
        {children}
      </main>
      <Footer />
    </div>
  );
}
