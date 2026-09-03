"use client";

import { useState, useEffect, useId } from "react";
import { CrownIcon, Loader2, Ban } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getPaidPlans } from "@/lib/billing/catalog";

interface GiftSubscriptionModalProps {
  open: boolean;
  onClose: () => void;
  onGift: (plan: string, endDate: string) => void;
  onRevoke: () => void;
  isLoading: boolean;
  existingGift?: { plan: string; end_date: string } | null;
}

const GIFTABLE_PLANS = getPaidPlans();
const PLAN_LABELS: Record<string, string> = Object.fromEntries(
  GIFTABLE_PLANS.map((p) => [p.id, p.name]),
);

/**
 * Modal for gifting or managing subscriptions.
 *
 * Built on components/ui/dialog (Radix) rather than a hand-rolled
 * `fixed inset-0` overlay, which is what this used to be. Radix supplies the
 * focus trap, focus restore on close, Escape-to-close, `role="dialog"` +
 * `aria-modal`, a portal, and a body scroll lock: none of which the hand-
 * rolled version had, on a modal that hands out paid plans. Its sibling
 * user-detail-panel.tsx already used Dialog, so the split ran through one
 * directory.
 *
 * Revoke fires straight through to the caller. It used to sit behind a
 * two-click inline "Are you sure?" whose Yes button then opened the parent's
 * SaveConfirmationModal, so revoking a gift was confirmed twice.
 */
export function GiftSubscriptionModal({
  open,
  onClose,
  onGift,
  onRevoke,
  isLoading,
  existingGift,
}: GiftSubscriptionModalProps) {
  const [giftPlan, setGiftPlan] = useState(
    existingGift?.plan || "pro_supporter",
  );
  const [giftEndDate, setGiftEndDate] = useState(
    existingGift?.end_date
      ? new Date(existingGift.end_date).toISOString().slice(0, 16)
      : "",
  );

  // Stable ids so each <label htmlFor> names its control; both fields were
  // announced as unnamed to a screen reader.
  const planId = useId();
  const endDateId = useId();

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- resets this modal's editable form fields from the existingGift prop whenever it reopens for a (possibly different) record
      setGiftPlan(existingGift?.plan || "pro_supporter");
      setGiftEndDate(
        existingGift?.end_date
          ? new Date(existingGift.end_date).toISOString().slice(0, 16)
          : "",
      );
    }
  }, [open, existingGift]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent variant="shell" size="sm">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              <CrownIcon className="h-4 w-4 text-primary" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <DialogTitle>
                {existingGift
                  ? "Manage Gift Subscription"
                  : "Gift a Subscription"}
              </DialogTitle>
              <DialogDescription>
                {existingGift
                  ? `Active until ${new Date(existingGift.end_date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`
                  : "Grant temporary premium access"}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <DialogBody className="flex flex-col gap-4">
          {/* Active gift banner */}
          {existingGift && (
            <div className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-lg border bg-primary/5 border-primary/20 text-primary text-xs font-medium">
              <CrownIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              Currently gifted:
              <span className="font-semibold ml-1">
                {PLAN_LABELS[existingGift.plan] || existingGift.plan}
              </span>
            </div>
          )}

          {/* Form */}
          {/* One column below sm: the right cell is a datetime-local input,
              which needs about 190px to print "09/01/2026, 12:00 PM" plus its
              picker glyph, and a half-width dialog column on a phone is
              roughly 130px. */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor={planId}
                className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider"
              >
                Plan
              </label>
              <select
                id={planId}
                value={giftPlan}
                onChange={(e) => setGiftPlan(e.target.value)}
                className="h-9 rounded-md border border-border/40 bg-background/50 px-2.5 text-sm text-foreground focus:outline-hidden focus:ring-2 focus:ring-primary/20 focus:border-primary/50"
              >
                {GIFTABLE_PLANS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor={endDateId}
                className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider"
              >
                Expires
              </label>
              <input
                id={endDateId}
                type="datetime-local"
                value={giftEndDate}
                onChange={(e) => setGiftEndDate(e.target.value)}
                className="h-9 rounded-md border border-border/40 bg-background/50 px-2.5 text-sm text-foreground focus:outline-hidden focus:ring-2 focus:ring-primary/20 focus:border-primary/50"
              />
            </div>
          </div>

          <p className="text-[11px] text-muted-foreground leading-relaxed">
            {existingGift
              ? "Saving will overwrite the existing gift. User reverts to their base plan when it expires."
              : "User reverts to free plan when the gift expires. This is logged in the audit trail."}
          </p>

          {/* Revoke stays in the body rather than joining the footer band:
              it is not the answer to this dialog, it undoes a gift that
              already exists, and the divider above it is what says so. */}
          {existingGift && (
            <div className="pt-2 border-t border-border">
              <Button
                variant="outline"
                size="sm"
                className="w-full h-8 text-xs text-destructive border-destructive/30 hover:bg-destructive/5 hover:border-destructive/50 gap-1.5"
                onClick={onRevoke}
                disabled={isLoading}
              >
                <Ban className="h-3.5 w-3.5" aria-hidden="true" />
                Revoke Active Gift
              </Button>
            </div>
          )}
        </DialogBody>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={onClose}
            disabled={isLoading}
            className="text-muted-foreground hover:text-foreground"
          >
            Cancel
          </Button>
          <Button
            className="gap-1.5"
            disabled={!giftEndDate || isLoading}
            onClick={() =>
              onGift(giftPlan, new Date(giftEndDate).toISOString())
            }
          >
            {isLoading ? (
              <>
                <Loader2
                  className="h-3.5 w-3.5 animate-spin"
                  aria-hidden="true"
                />{" "}
                Saving...
              </>
            ) : (
              <>
                <CrownIcon className="h-3.5 w-3.5" aria-hidden="true" />{" "}
                {existingGift ? "Update Gift" : "Gift Plan"}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
