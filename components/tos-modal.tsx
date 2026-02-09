"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Shield, ExternalLink } from "lucide-react"

interface TosModalProps {
  onAccept: () => void
}

export function TosModal({ onAccept }: TosModalProps) {
  const [accepting, setAccepting] = useState(false)
  const [checked, setChecked] = useState({
    terms: false,
    authorization: false,
    research: false,
    liability: false,
  })

  const allChecked = Object.values(checked).every(Boolean)

  async function handleAccept() {
    if (!allChecked) return
    setAccepting(true)
    try {
      const res = await fetch("/api/auth/accept-tos", { method: "POST" })
      if (res.ok) {
        onAccept()
      }
    } catch {
      // retry on next attempt
    } finally {
      setAccepting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg rounded-2xl border border-border bg-card shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex flex-col items-center gap-3 px-6 pt-8 pb-4">
          <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-primary/10 border border-primary/20">
            <Shield className="h-6 w-6 text-primary" />
          </div>
          <h2 className="text-xl font-bold text-foreground text-center text-balance">
            Terms of Service Agreement
          </h2>
          <p className="text-sm text-muted-foreground text-center leading-relaxed max-w-sm">
            Before using VulnRadar, you must read and agree to the following terms.
          </p>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          <div className="rounded-xl border border-border bg-muted/30 p-4 mb-5">
            <p className="text-sm text-foreground/90 font-medium leading-relaxed">
              VulnRadar is a security scanning tool intended{" "}
              <strong>exclusively for authorized security testing, research, and educational purposes</strong>.
              Unauthorized use may violate federal and international cybercrime laws.
            </p>
          </div>

          <div className="flex flex-col gap-4">
            <label className="flex items-start gap-3 cursor-pointer group">
              <input
                type="checkbox"
                checked={checked.terms}
                onChange={(e) => setChecked((p) => ({ ...p, terms: e.target.checked }))}
                className="mt-1 h-4 w-4 rounded border-border text-primary accent-[hsl(var(--primary))] shrink-0"
              />
              <span className="text-sm text-foreground/80 leading-relaxed group-hover:text-foreground transition-colors">
                I have read and agree to the{" "}
                <a href="/legal/terms" target="_blank" className="text-primary hover:underline inline-flex items-center gap-0.5">
                  Terms of Service <ExternalLink className="h-3 w-3" />
                </a>,{" "}
                <a href="/legal/privacy" target="_blank" className="text-primary hover:underline inline-flex items-center gap-0.5">
                  Privacy Policy <ExternalLink className="h-3 w-3" />
                </a>, and{" "}
                <a href="/legal/acceptable-use" target="_blank" className="text-primary hover:underline inline-flex items-center gap-0.5">
                  Acceptable Use Policy <ExternalLink className="h-3 w-3" />
                </a>.
              </span>
            </label>

            <label className="flex items-start gap-3 cursor-pointer group">
              <input
                type="checkbox"
                checked={checked.authorization}
                onChange={(e) => setChecked((p) => ({ ...p, authorization: e.target.checked }))}
                className="mt-1 h-4 w-4 rounded border-border text-primary accent-[hsl(var(--primary))] shrink-0"
              />
              <span className="text-sm text-foreground/80 leading-relaxed group-hover:text-foreground transition-colors">
                I understand that I may <strong>only scan websites that I own or have explicit
                written authorization to test</strong>. Unauthorized scanning may be a criminal offense.
              </span>
            </label>

            <label className="flex items-start gap-3 cursor-pointer group">
              <input
                type="checkbox"
                checked={checked.research}
                onChange={(e) => setChecked((p) => ({ ...p, research: e.target.checked }))}
                className="mt-1 h-4 w-4 rounded border-border text-primary accent-[hsl(var(--primary))] shrink-0"
              />
              <span className="text-sm text-foreground/80 leading-relaxed group-hover:text-foreground transition-colors">
                I confirm that I am using VulnRadar for{" "}
                <strong>legitimate security research, testing, or educational purposes only</strong>{" "}
                and not for any malicious, illegal, or unauthorized activity.
              </span>
            </label>

            <label className="flex items-start gap-3 cursor-pointer group">
              <input
                type="checkbox"
                checked={checked.liability}
                onChange={(e) => setChecked((p) => ({ ...p, liability: e.target.checked }))}
                className="mt-1 h-4 w-4 rounded border-border text-primary accent-[hsl(var(--primary))] shrink-0"
              />
              <span className="text-sm text-foreground/80 leading-relaxed group-hover:text-foreground transition-colors">
                I acknowledge that VulnRadar and its operators are{" "}
                <strong>NOT responsible for any misuse, damages, or legal consequences</strong>{" "}
                resulting from my use of this tool. I accept full responsibility for my actions.
              </span>
            </label>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-5 border-t border-border">
          <Button
            onClick={handleAccept}
            disabled={!allChecked || accepting}
            className="w-full h-11"
          >
            {accepting ? "Processing..." : allChecked ? "I Agree, Continue to VulnRadar" : "Check all boxes to continue"}
          </Button>
          <p className="text-xs text-muted-foreground text-center mt-3 leading-relaxed">
            By clicking &quot;I Agree&quot;, you are entering a legally binding agreement.
            Read the{" "}
            <a href="/legal/disclaimer" target="_blank" className="text-primary hover:underline">
              full disclaimer
            </a>{" "}
            for more information.
          </p>
        </div>
      </div>
    </div>
  )
}
