"use client"

import { useState, useEffect } from "react"
import { CrownIcon, X, Loader2, Ban } from "lucide-react"
import { Button } from "@/components/ui/button"

interface GiftSubscriptionModalProps {
  open: boolean
  onClose: () => void
  onGift: (plan: string, endDate: string) => void
  onRevoke: () => void
  isLoading: boolean
  existingGift?: { plan: string; end_date: string } | null
}

const PLAN_LABELS: Record<string, string> = {
  core_supporter: "Core Supporter",
  pro_supporter: "Pro Supporter",
  elite_supporter: "Elite Supporter",
}

/**
 * Modal for gifting or managing subscriptions
 */
export function GiftSubscriptionModal({
  open,
  onClose,
  onGift,
  onRevoke,
  isLoading,
  existingGift,
}: GiftSubscriptionModalProps) {
  const [giftPlan, setGiftPlan] = useState(existingGift?.plan || "pro_supporter")
  const [giftEndDate, setGiftEndDate] = useState(
    existingGift?.end_date
      ? new Date(existingGift.end_date).toISOString().slice(0, 16)
      : ""
  )
  const [confirmRevoke, setConfirmRevoke] = useState(false)

  useEffect(() => {
    if (open) {
      setGiftPlan(existingGift?.plan || "pro_supporter")
      setGiftEndDate(
        existingGift?.end_date
          ? new Date(existingGift.end_date).toISOString().slice(0, 16)
          : ""
      )
      setConfirmRevoke(false)
    }
  }, [open, existingGift])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in">
      <div className="bg-card border border-border rounded-xl w-full max-w-md mx-4 shadow-2xl animate-in zoom-in-95 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center">
              <CrownIcon className="h-4 w-4 text-primary" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground">
                {existingGift ? "Manage Gift Subscription" : "Gift a Subscription"}
              </h3>
              <p className="text-[11px] text-muted-foreground">
                {existingGift
                  ? `Active until ${new Date(existingGift.end_date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`
                  : "Grant temporary premium access"}
              </p>
            </div>
          </div>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Active gift banner */}
        {existingGift && (
          <div className="mx-5 mt-4 flex items-center gap-2.5 px-3.5 py-2.5 rounded-lg border bg-primary/5 border-primary/20 text-primary text-xs font-medium">
            <CrownIcon className="h-3.5 w-3.5 shrink-0" />
            Currently gifted: <span className="font-semibold ml-1">{PLAN_LABELS[existingGift.plan] || existingGift.plan}</span>
          </div>
        )}

        {/* Form */}
        <div className="p-5 flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Plan</label>
              <select
                value={giftPlan}
                onChange={(e) => setGiftPlan(e.target.value)}
                className="h-9 rounded-md border border-border bg-background px-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
              >
                <option value="core_supporter">Core Supporter</option>
                <option value="pro_supporter">Pro Supporter</option>
                <option value="elite_supporter">Elite Supporter</option>
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Expires</label>
              <input
                type="datetime-local"
                value={giftEndDate}
                onChange={(e) => setGiftEndDate(e.target.value)}
                className="h-9 rounded-md border border-border bg-background px-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>
          </div>

          <p className="text-[11px] text-muted-foreground leading-relaxed">
            {existingGift
              ? "Saving will overwrite the existing gift. User reverts to their base plan when it expires."
              : "User reverts to free plan when the gift expires. This is logged in the audit trail."}
          </p>

          <div className="flex items-center gap-2">
            <Button
              className="flex-1 gap-1.5"
              disabled={!giftEndDate || isLoading}
              onClick={() => onGift(giftPlan, new Date(giftEndDate).toISOString())}
            >
              {isLoading ? (
                <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving...</>
              ) : (
                <><CrownIcon className="h-3.5 w-3.5" /> {existingGift ? "Update Gift" : "Gift Plan"}</>
              )}
            </Button>
            <Button variant="ghost" className="flex-1" onClick={onClose} disabled={isLoading}>
              Cancel
            </Button>
          </div>

          {/* Revoke — only shown when there's an active gift */}
          {existingGift && (
            <div className="pt-2 border-t border-border">
              {!confirmRevoke ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full h-8 text-xs text-destructive dark:text-red-400 border-destructive/30 hover:bg-destructive/5 hover:border-destructive/50 gap-1.5"
                  onClick={() => setConfirmRevoke(true)}
                  disabled={isLoading}
                >
                  <Ban className="h-3.5 w-3.5" />
                  Revoke Active Gift
                </Button>
              ) : (
                <div className="flex flex-col gap-2">
                  <p className="text-[11px] text-destructive text-center font-medium">
                    Are you sure? This will immediately remove their gift access.
                  </p>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      className="flex-1 h-8 text-xs bg-destructive hover:bg-destructive/90 text-destructive-foreground gap-1.5"
                      onClick={onRevoke}
                      disabled={isLoading}
                    >
                      {isLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Ban className="h-3.5 w-3.5" />}
                      Yes, Revoke
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="flex-1 h-8 text-xs"
                      onClick={() => setConfirmRevoke(false)}
                      disabled={isLoading}
                    >
                      Keep Gift
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
