"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Shield, ExternalLink, Check, Lock, ShieldCheck } from "lucide-react"
import { APP_NAME } from "@/lib/constants"

interface TosModalProps {
  onAccept: () => void
}

const CHECKBOXES = [
  {
    key: "terms" as const,
    title: "Legal Agreements",
    label: (
        <>
          I have read and agree to the{" "}
          <a href="/legal/terms" target="_blank" className="text-primary hover:text-primary/80 underline underline-offset-2 decoration-primary/40 hover:decoration-primary inline-flex items-center gap-1 transition-colors">
            Terms of Service <ExternalLink className="h-2.5 w-2.5" />
          </a>
          ,{" "}
          <a href="/legal/privacy" target="_blank" className="text-primary hover:text-primary/80 underline underline-offset-2 decoration-primary/40 hover:decoration-primary inline-flex items-center gap-1 transition-colors">
            Privacy Policy <ExternalLink className="h-2.5 w-2.5" />
          </a>
          , and the{" "}
          <a href="/legal/acceptable-use" target="_blank" className="text-primary hover:text-primary/80 underline underline-offset-2 decoration-primary/40 hover:decoration-primary inline-flex items-center gap-1 transition-colors">
            Acceptable Use Policy <ExternalLink className="h-2.5 w-2.5" />
          </a>
          .
        </>
    ),
  },
  {
    key: "authorization" as const,
    title: "Authorized Use Only",
    label: (
        <>
          I will only scan systems I{" "}
          <strong className="text-foreground font-semibold">own or have explicit written authorization</strong>{" "}
          to test. I understand that unauthorized scanning may constitute a criminal offense under applicable law.
        </>
    ),
  },
  {
    key: "research" as const,
    title: "Legitimate Purpose",
    label: (
        <>
          I am using {APP_NAME} solely for{" "}
          <strong className="text-foreground font-semibold">legitimate security research, testing, or educational purposes</strong>.
          I will not use it for any malicious, harmful, or unauthorized activity.
        </>
    ),
  },
  {
    key: "liability" as const,
    title: "Assumption of Liability",
    label: (
        <>
          I acknowledge that {APP_NAME} and its operators bear{" "}
          <strong className="text-foreground font-semibold">no liability for misuse, damages, or legal consequences</strong>.
          I accept full personal and legal responsibility for all actions taken with this tool.
        </>
    ),
  },
]

export function TosModal({ onAccept }: TosModalProps) {
  const [accepting, setAccepting] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [checked, setChecked] = useState({
    terms: false,
    authorization: false,
    research: false,
    liability: false,
  })

  useEffect(() => {
    // Slight delay so CSS animations fire after paint
    const t = setTimeout(() => setMounted(true), 16)
    return () => clearTimeout(t)
  }, [])

  const allChecked = Object.values(checked).every(Boolean)
  const checkedCount = Object.values(checked).filter(Boolean).length
  const progress = (checkedCount / 4) * 100

  async function handleAccept() {
    if (!allChecked) return
    setAccepting(true)
    try {
      const res = await fetch("/api/v1/auth/accept-tos", { method: "POST" })
      if (res.ok) onAccept()
    } catch {
      // retry on next attempt
    } finally {
      setAccepting(false)
    }
  }

  return (
      <>
        <style>{`
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(20px) scale(0.99); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes progressShimmer {
          0%   { background-position: -200% center; }
          100% { background-position: 200% center; }
        }
        @keyframes checkPop {
          0%   { transform: scale(0.6); opacity: 0; }
          60%  { transform: scale(1.15); }
          100% { transform: scale(1); opacity: 1; }
        }
        @keyframes ringPulse {
          0%   { box-shadow: 0 0 0 0 hsl(var(--primary) / 0.25); }
          70%  { box-shadow: 0 0 0 7px hsl(var(--primary) / 0); }
          100% { box-shadow: 0 0 0 0 hsl(var(--primary) / 0); }
        }
        .tos-backdrop { animation: fadeIn 0.25s ease forwards; }
        .tos-modal   { animation: fadeUp 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
        .tos-item-1  { animation: fadeUp 0.38s 0.13s cubic-bezier(0.16,1,0.3,1) both; }
        .tos-item-2  { animation: fadeUp 0.38s 0.20s cubic-bezier(0.16,1,0.3,1) both; }
        .tos-item-3  { animation: fadeUp 0.38s 0.27s cubic-bezier(0.16,1,0.3,1) both; }
        .tos-item-4  { animation: fadeUp 0.38s 0.34s cubic-bezier(0.16,1,0.3,1) both; }
        .check-pop   { animation: checkPop 0.25s cubic-bezier(0.34,1.56,0.64,1) forwards; }
        .shield-ring { animation: ringPulse 2.8s ease-out infinite; }
        .progress-live {
          background: linear-gradient(90deg,
            hsl(var(--primary)) 0%,
            hsl(var(--primary)/0.6) 45%,
            hsl(var(--primary)) 60%,
            hsl(var(--primary)) 100%
          );
          background-size: 200% auto;
          animation: progressShimmer 1.8s linear infinite;
        }
      `}</style>

        {/* ── Backdrop ── */}
        <div className={`fixed inset-0 z-[100] flex items-end sm:items-center justify-center sm:p-4 ${mounted ? "tos-backdrop" : "opacity-0"}`}>
          <div className="absolute inset-0 bg-background/65 backdrop-blur-xl" />

          {/* ── Modal card ── */}
          <div
              className={`relative w-full sm:max-w-[432px] rounded-t-[28px] sm:rounded-2xl border border-border/50 flex flex-col overflow-hidden ${mounted ? "tos-modal" : "opacity-0"}`}
              style={{
                background: "hsl(var(--card))",
                maxHeight: "calc(100dvh - 48px)",
                boxShadow:
                    "0 0 0 1px hsl(var(--border)/0.4), 0 24px 64px -8px hsl(0 0% 0% / 0.35), 0 8px 20px -4px hsl(0 0% 0% / 0.15)",
              }}
          >
            {/* Progress bar */}
            <div className="relative h-[2px] w-full bg-border/30 overflow-hidden shrink-0">
              <div
                  className={`absolute left-0 top-0 h-full transition-[width] duration-700 ease-out ${checkedCount > 0 ? "progress-live" : "bg-transparent"}`}
                  style={{ width: `${progress}%` }}
              />
            </div>

            {/* ── Header ── */}
            <div className="px-7 pt-6 pb-5 border-b border-border/30 shrink-0">
              <div className="flex items-center gap-4">
                {/* Shield icon with pulse ring */}
                <div
                    className="shield-ring flex items-center justify-center rounded-xl bg-primary/10 border border-primary/20 shrink-0"
                    style={{ width: 40, height: 40 }}
                >
                  <Shield style={{ width: 17, height: 17 }} className="text-primary" />
                </div>

                <div className="flex-1 min-w-0">
                  <h2 className="text-[14.5px] font-semibold text-foreground tracking-tight leading-snug">
                    Terms of Service
                  </h2>
                  <p className="text-[11.5px] text-muted-foreground mt-0.5">
                    Review and confirm each item to continue
                  </p>
                </div>

                {/* Circular progress counter */}
                <div className="relative shrink-0 flex items-center justify-center" style={{ width: 38, height: 38 }}>
                  <svg width="38" height="38" viewBox="0 0 38 38" className="-rotate-90" style={{ overflow: "visible" }}>
                    <circle cx="19" cy="19" r="16" fill="none" stroke="hsl(var(--border))" strokeWidth="2" />
                    <circle
                        cx="19" cy="19" r="16"
                        fill="none"
                        stroke="hsl(var(--primary))"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeDasharray={`${2 * Math.PI * 16}`}
                        strokeDashoffset={`${2 * Math.PI * 16 * (1 - checkedCount / 4)}`}
                        className="transition-all duration-500 ease-out"
                    />
                  </svg>
                  <span className="absolute text-[11px] font-semibold tabular-nums" style={{ color: checkedCount === 4 ? "hsl(var(--primary))" : "hsl(var(--foreground))" }}>
                  {checkedCount}/4
                </span>
                </div>
              </div>

              {/* Info callout */}
              <div className="mt-4 rounded-xl border border-border/40 px-4 py-3 bg-muted/35">
                <p className="text-[11.5px] text-muted-foreground leading-relaxed">
                  {APP_NAME} is intended <span className="font-semibold text-foreground/80">exclusively</span> for
                  authorized security testing, research, and educational use. Misuse may violate
                  federal and international cybercrime laws, including the CFAA and its equivalents.
                </p>
              </div>
            </div>

            {/* ── Checkboxes ── */}
            <div className="flex-1 overflow-y-auto px-7 py-4 space-y-1 overscroll-contain">
              {CHECKBOXES.map(({ key, title, label }, i) => (
                  <label
                      key={key}
                      className={`tos-item-${i + 1} flex items-start gap-3.5 cursor-pointer rounded-xl px-3.5 py-3 -mx-3.5 transition-colors duration-150 ${
                          checked[key] ? "bg-primary/[0.06]" : "hover:bg-muted/40"
                      }`}
                      style={{ opacity: 0 }}
                      onClick={() => setChecked((p) => ({ ...p, [key]: !p[key] }))}
                  >
                    {/* Custom checkbox */}
                    <div
                        className={`mt-[3px] rounded-md flex items-center justify-center shrink-0 transition-all duration-200 ${
                            checked[key]
                                ? "bg-primary border-transparent"
                                : "border border-border/70 bg-background"
                        }`}
                        style={{
                          width: 17, height: 17, minWidth: 17,
                          borderWidth: checked[key] ? 0 : 1.5,
                        }}
                    >
                      {checked[key] && (
                          <span className="check-pop flex items-center justify-center">
                      <Check strokeWidth={3.5} className="text-primary-foreground" style={{ width: 9, height: 9 }} />
                    </span>
                      )}
                    </div>

                    {/* Label */}
                    <div className="min-w-0">
                      <p className={`text-[10px] font-semibold uppercase tracking-[0.08em] mb-[5px] transition-colors duration-200 ${
                          checked[key] ? "text-primary" : "text-muted-foreground/50"
                      }`}>
                        {title}
                      </p>
                      <p className="text-[12.5px] text-muted-foreground leading-relaxed select-none">
                        {label}
                      </p>
                    </div>
                  </label>
              ))}
            </div>

            {/* ── Footer ── */}
            <div className="px-7 pb-6 pt-4 border-t border-border/30 space-y-2.5 shrink-0">
              <Button
                  onClick={handleAccept}
                  disabled={!allChecked || accepting}
                  className={`w-full h-11 text-[13px] font-semibold tracking-tight transition-all duration-300 ${
                      allChecked && !accepting ? "shadow-md shadow-primary/20" : ""
                  }`}
              >
                {accepting ? (
                    <span className="flex items-center gap-2">
                  <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Processing
                </span>
                ) : allChecked ? (
                    <span className="flex items-center gap-2">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  I Agree - Continue to {APP_NAME}
                </span>
                ) : (
                    `${checkedCount} of 4 items confirmed`
                )}
              </Button>

              <p className="text-[11px] text-muted-foreground/55 text-center leading-relaxed">
                By continuing, you enter a legally binding agreement.{" "}
                <a href="/legal/disclaimer" target="_blank" className="text-primary/70 hover:text-primary underline underline-offset-2 decoration-primary/30 transition-colors">
                  View full disclaimer
                </a>
              </p>

              <p className="text-[10px] text-muted-foreground/30 text-center leading-relaxed pt-1.5 border-t border-border/25">
                Any use of this service, regardless of how access is obtained, is subject to these terms.
                Bypassing this screen does not waive legal liability.
              </p>
            </div>
          </div>
        </div>
      </>
  )
}
