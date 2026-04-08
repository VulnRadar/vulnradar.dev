"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Shield, ExternalLink, Check, ShieldCheck, RefreshCw, AlertCircle } from "lucide-react"
import { APP_NAME, API, TERMS_UPDATED_AT } from "@/lib/config/constants"

interface TosModalProps {
  onAccept: () => void
  isUpdate?: boolean
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
        ,{" "}
        <a href="/legal/acceptable-use" target="_blank" className="text-primary hover:text-primary/80 underline underline-offset-2 decoration-primary/40 hover:decoration-primary inline-flex items-center gap-1 transition-colors">
          Acceptable Use Policy <ExternalLink className="h-2.5 w-2.5" />
        </a>
        , and{" "}
        <a href="/legal/disclaimer" target="_blank" className="text-primary hover:text-primary/80 underline underline-offset-2 decoration-primary/40 hover:decoration-primary inline-flex items-center gap-1 transition-colors">
          Disclaimer <ExternalLink className="h-2.5 w-2.5" />
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
        to test. I understand that unauthorized scanning may constitute a criminal offense under applicable law (including the CFAA).
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
    key: "datadeletion" as const,
    title: "Data Deletion Policy",
    label: (
      <>
        I acknowledge that {APP_NAME}{" "}
        <strong className="text-foreground font-semibold">may delete my account data, scan history, or any other information at any time and for any reason</strong>,
        including policy violations, security concerns, or routine maintenance. {APP_NAME} is not liable for any data loss resulting from deletion.
      </>
    ),
  },
  {
    key: "liability" as const,
    title: "Assumption of Liability & Jurisdiction",
    label: (
      <>
        I acknowledge that {APP_NAME} and its operators bear{" "}
        <strong className="text-foreground font-semibold">no liability for misuse, damages, or legal consequences</strong>.
        I accept full personal responsibility and agree that disputes will be governed by Missouri law with binding arbitration.
      </>
    ),
  },
]

function formatDate(dateStr: string): string {
  const date = new Date(dateStr)
  return date.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
}

export function TosModal({ onAccept, isUpdate = false }: TosModalProps) {
  const [accepting, setAccepting] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [checked, setChecked] = useState({
    terms: false,
    authorization: false,
    research: false,
    datadeletion: false,
    liability: false,
  })

  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 16)
    return () => clearTimeout(t)
  }, [])

  const allChecked = Object.values(checked).every(Boolean)
  const checkedCount = Object.values(checked).filter(Boolean).length
  const progress = (checkedCount / 5) * 100

  async function handleAccept() {
    if (!allChecked) return
    setAccepting(true)
    try {
      const res = await fetch(API.AUTH.ACCEPT_TOS, { method: "POST" })
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
        @keyframes checkPop {
          0%   { transform: scale(0.6); opacity: 0; }
          60%  { transform: scale(1.15); }
          100% { transform: scale(1); opacity: 1; }
        }
        .tos-backdrop { animation: fadeIn 0.25s ease forwards; }
        .tos-modal   { animation: fadeUp 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
        .tos-item-1  { animation: fadeUp 0.38s 0.13s cubic-bezier(0.16,1,0.3,1) both; }
        .tos-item-2  { animation: fadeUp 0.38s 0.20s cubic-bezier(0.16,1,0.3,1) both; }
        .tos-item-3  { animation: fadeUp 0.38s 0.27s cubic-bezier(0.16,1,0.3,1) both; }
        .tos-item-4  { animation: fadeUp 0.38s 0.34s cubic-bezier(0.16,1,0.3,1) both; }
        .tos-item-5  { animation: fadeUp 0.38s 0.41s cubic-bezier(0.16,1,0.3,1) both; }
        .check-pop   { animation: checkPop 0.25s cubic-bezier(0.34,1.56,0.64,1) forwards; }
      `}</style>

      {/* ── Backdrop ── */}
      <div className={`fixed inset-0 z-[100] flex items-end sm:items-center justify-center sm:p-4 ${mounted ? "tos-backdrop" : "opacity-0"}`}>
        <div className="absolute inset-0 bg-background/65 backdrop-blur-xl" />

        {/* ── Modal card ── */}
        <div
          className={`relative w-full sm:max-w-[432px] rounded-t-3xl sm:rounded-2xl border border-border/50 flex flex-col overflow-hidden ${mounted ? "tos-modal" : "opacity-0"}`}
          style={{
            background: "hsl(var(--card))",
            maxHeight: "calc(100dvh - 48px)",
            boxShadow: "0 0 0 1px hsl(var(--border)/0.4), 0 24px 64px -8px hsl(0 0% 0% / 0.35), 0 8px 20px -4px hsl(0 0% 0% / 0.15)",
          }}
        >
          {/* ── Header ── */}
          <div className="px-6 pt-6 pb-4 border-b border-border/40 shrink-0">
            <div className="flex items-start gap-4">
              {/* Icon */}
              <div className={`p-2.5 rounded-xl shrink-0 ${isUpdate ? "bg-amber-500/15 border border-amber-500/30" : "bg-primary/15 border border-primary/30"}`}>
                {isUpdate ? (
                  <RefreshCw className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                ) : (
                  <Shield className="h-5 w-5 text-primary" />
                )}
              </div>

              {/* Title & subtitle */}
              <div className="flex-1">
                <h2 className="text-base font-semibold text-foreground">{isUpdate ? "Terms Updated" : "Terms of Service"}</h2>
                <p className="text-xs text-muted-foreground mt-1">
                  {isUpdate 
                    ? `Updated ${formatDate(TERMS_UPDATED_AT)} - Please review and accept`
                    : "Review and confirm to continue"
                  }
                </p>
              </div>

              {/* Progress counter */}
              <div className="flex flex-col items-center gap-1 shrink-0">
                <div className="text-xs font-semibold">{checkedCount}/5</div>
                <div className="w-8 h-1 bg-border/30 rounded-full overflow-hidden">
                  <div className="h-full bg-primary transition-all duration-300" style={{ width: `${progress}%` }} />
                </div>
              </div>
            </div>

            {/* Update callout - clean & simple */}
            {isUpdate && (
              <div className="mt-4 p-3 rounded-lg border border-amber-500/20 bg-amber-500/5 flex gap-3">
                <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-xs text-foreground font-medium mb-1">Updated privacy policies and data handling</p>
                  <p className="text-xs text-muted-foreground">Enhanced CCPA/CPRA compliance, added arbitration clauses, and improved liability limitations.</p>
                </div>
              </div>
            )}

            {/* Initial callout */}
            {!isUpdate && (
              <div className="mt-4 p-3 rounded-lg border border-primary/20 bg-primary/5 flex gap-3">
                <Shield className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                <p className="text-xs text-muted-foreground">
                  {APP_NAME} is for <span className="font-medium text-foreground">authorized security testing only</span>. Misuse may violate federal law.
                </p>
              </div>
            )}
          </div>

          {/* ── Checkboxes ── */}
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-2 overscroll-contain">
            {CHECKBOXES.map(({ key, title, label }, i) => (
              <label
                key={key}
                className={`tos-item-${i + 1} flex items-start gap-3 cursor-pointer rounded-lg px-3 py-3 -mx-3 transition-colors duration-150 ${
                  checked[key] ? "bg-muted/50" : "hover:bg-muted/30"
                }`}
                style={{ opacity: 0 }}
                onClick={() => setChecked((p) => ({ ...p, [key]: !p[key] }))}
              >
                {/* Checkbox */}
                <div
                  className={`mt-0.5 rounded-md flex items-center justify-center shrink-0 transition-all duration-200 ${
                    checked[key] ? "bg-primary border-primary" : "border border-border/50 bg-background"
                  }`}
                  style={{ width: 18, height: 18, minWidth: 18 }}
                >
                  {checked[key] && (
                    <span className="check-pop">
                      <Check strokeWidth={3} className="text-primary-foreground" style={{ width: 10, height: 10 }} />
                    </span>
                  )}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <p className={`text-xs font-semibold uppercase tracking-wide mb-1 transition-colors ${checked[key] ? "text-primary" : "text-muted-foreground/60"}`}>
                    {title}
                  </p>
                  <p className="text-sm text-muted-foreground leading-relaxed">{label}</p>
                </div>
              </label>
            ))}
          </div>

          {/* ── Footer ── */}
          <div className="px-6 py-4 border-t border-border/40 shrink-0 space-y-3">
            <Button
              onClick={handleAccept}
              disabled={!allChecked || accepting}
              className="w-full h-10 text-sm font-semibold"
            >
              {accepting ? (
                <span className="flex items-center gap-2">
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Processing
                </span>
              ) : allChecked ? (
                <span className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4" />
                  {isUpdate ? "Accept Updated Terms" : "I Agree & Continue"}
                </span>
              ) : (
                `${checkedCount} of 5 confirmed`
              )}
            </Button>

            <div className="flex items-center justify-center gap-1">
              <p className="text-xs text-muted-foreground/60">By continuing, you agree to</p>
              <a href="/legal/disclaimer" target="_blank" className="text-xs text-primary hover:text-primary/80 underline underline-offset-2 transition-colors">
                full terms
              </a>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
