"use client";

import Link from "next/link";
import { ThemedLogo } from "@/components/shared/themed-logo";
import { APP_NAME } from "@/lib/config/constants";

function ScanVisual() {
  return (
    <div
      className="relative w-full max-w-[280px] mx-auto mt-10 select-none"
      aria-hidden="true"
    >
      {/* Mini browser chrome */}
      <div className="rounded-xl border border-white/10 bg-background/30 backdrop-blur-sm overflow-hidden shadow-2xl">
        <div className="flex items-center gap-1.5 px-3 py-2 bg-background/40 border-b border-white/[0.06]">
          <div className="h-2 w-2 rounded-full bg-red-400/50" />
          <div className="h-2 w-2 rounded-full bg-amber-400/50" />
          <div className="h-2 w-2 rounded-full bg-emerald-400/50" />
          <div className="flex-1 ml-1.5 rounded px-2 py-0.5 bg-background/50 border border-white/[0.04] text-[10px] font-mono text-white/35 truncate">
            https://yourdomain.com
          </div>
        </div>
        <div className="relative h-[88px] bg-background/10 overflow-hidden">
          <div
            className="absolute left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-primary to-transparent"
            style={{ animation: "scan 2.2s ease-in-out infinite" }}
          />
          <div
            className="absolute left-0 right-0 h-10 -translate-y-5"
            style={{
              background:
                "linear-gradient(to bottom, transparent, hsl(var(--primary)/0.06), transparent)",
              animation: "scan 2.2s ease-in-out infinite",
            }}
          />
        </div>
      </div>

      {/* Findings appearing below */}
      <div className="mt-2.5 space-y-1.5">
        {[
          {
            id: "hsts-missing",
            sev: "MED",
            clr: "text-amber-400",
            border: "border-amber-500/20 bg-amber-500/5",
          },
          {
            id: "csp-not-set",
            sev: "HIGH",
            clr: "text-orange-400",
            border: "border-orange-500/20 bg-orange-500/5",
          },
          {
            id: "x-frame-options",
            sev: "LOW",
            clr: "text-emerald-400",
            border: "border-emerald-500/20 bg-emerald-500/5",
          },
        ].map((f, i) => (
          <div
            key={f.id}
            className={`flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-[11px] font-mono ${f.border}`}
            style={{
              opacity: 0,
              animation: "slide-up 0.35s ease-out forwards",
              animationDelay: `${700 + i * 180}ms`,
            }}
          >
            <span className={`font-semibold shrink-0 ${f.clr}`}>{f.sev}</span>
            <span className="text-white/45">{f.id}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

interface AuthSplitLayoutProps {
  children: React.ReactNode;
}

export function AuthSplitLayout({ children }: AuthSplitLayoutProps) {
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-2">
      {/* Left: Brand panel */}
      <div className="hidden lg:flex flex-col relative overflow-hidden bg-gradient-to-br from-background via-background to-primary/[0.05] border-r border-border/40">
        <div
          className="absolute inset-0 pointer-events-none opacity-[0.025]"
          style={{
            backgroundImage:
              "radial-gradient(circle at 1px 1px, hsl(var(--foreground)) 1px, transparent 0)",
            backgroundSize: "28px 28px",
          }}
        />
        <div className="absolute -top-40 -right-40 w-[480px] h-[480px] bg-primary/15 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-20 left-10 w-72 h-72 bg-primary/8 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 flex flex-col h-full p-10 xl:p-14">
          <Link href="/" className="flex items-center gap-2.5 group w-fit">
            <ThemedLogo
              width={28}
              height={28}
              className="h-7 w-7 transition-transform duration-200 group-hover:scale-105"
              alt={`${APP_NAME} logo`}
            />
            <span className="text-xl font-semibold tracking-tight">
              {APP_NAME}
            </span>
          </Link>

          <div className="flex-1 flex flex-col justify-center -mt-8">
            <div className="space-y-5 max-w-[300px]">
              <div>
                <p className="text-xs font-semibold text-primary/60 uppercase tracking-widest mb-3">
                  Web Vulnerability Scanner
                </p>
                <h2 className="text-3xl font-semibold tracking-tight leading-tight text-foreground">
                  Find security issues
                  <br />
                  before attackers do.
                </h2>
                <p className="mt-3 text-sm text-muted-foreground leading-relaxed">
                  Paste a URL and get a structured security report in under 3
                  seconds. No agent to install.
                </p>
              </div>

              <div className="space-y-2.5">
                {[
                  "700+ checks across 12 categories, all in parallel",
                  "Stable finding IDs — reference them in PRs and CI gates",
                  "Self-hostable, GPL-3.0, no vendor lock-in",
                ].map((point) => (
                  <div
                    key={point}
                    className="flex items-start gap-2.5 text-sm text-muted-foreground"
                  >
                    <div className="h-1.5 w-1.5 rounded-full bg-primary mt-[5px] shrink-0" />
                    {point}
                  </div>
                ))}
              </div>
            </div>

            <ScanVisual />
          </div>

          <p className="text-xs text-muted-foreground/40">
            Open source under GPL-3.0
          </p>
        </div>
      </div>

      {/* Right: Form panel */}
      <div className="flex flex-col items-center justify-center px-5 sm:px-8 py-12 min-h-screen lg:min-h-0 relative">
        <div className="lg:hidden mb-8">
          <Link href="/" className="flex items-center gap-2.5 group">
            <ThemedLogo
              width={28}
              height={28}
              className="h-7 w-7 transition-transform duration-200 group-hover:scale-105"
              alt={`${APP_NAME} logo`}
            />
            <span className="text-xl font-semibold tracking-tight">
              {APP_NAME}
            </span>
          </Link>
        </div>

        <div className="w-full max-w-sm">{children}</div>
      </div>
    </div>
  );
}
