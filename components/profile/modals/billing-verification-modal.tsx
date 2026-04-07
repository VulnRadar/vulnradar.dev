"use client"

import { useState, useEffect, useRef } from "react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Loader2, ShieldAlert, Mail } from "lucide-react"
import { useToast } from "@/components/ui/use-toast"

interface SensitiveBillingData {
  // Subscription info
  subscriptionId: string
  status: string
  created: string | null
  startDate: string | null
  currentPeriodStart: string | null
  currentPeriodEnd: string | null
  cancelAt: string | null
  canceledAt: string | null
  endedAt: string | null
  trialStart: string | null
  trialEnd: string | null
  cancelAtPeriodEnd: boolean
  billingCycleAnchor: number | null
  currency: string | null
  
  // Customer info
  customer: {
    email: string | null
    name: string | null
    phone: string | null
    balance: number | null
    delinquent: boolean
    taxExempt: string | null
    address: {
      line1?: string
      line2?: string
      city?: string
      state?: string
      postal_code?: string
      country?: string
    } | null
  }
  
  // Payment method
  paymentMethod: {
    id: string | null
    cardBrand: string | null
    cardLast4: string | null
    cardExpMonth: number | null
    cardExpYear: number | null
    cardFunding: string | null
    cardCountry: string | null
    cardFingerprint: string | null
    billingName: string | null
    billingEmail: string | null
    billingPhone: string | null
    cardSupports3dSecure: boolean
    cvvCheck: string | null
    postalCodeCheck: string | null
    addressLine1Check: string | null
    createdAt: string | null
  } | null
  
  // Invoice
  invoice: {
    id: string | null
    number: string | null
    amountPaid: number | null
    amountDue: number | null
    subtotal: number | null
    total: number | null
    tax: number | null
    status: string | null
    created: string | null
    hostedUrl: string | null
    pdfUrl: string | null
    billingReason: string | null
    paidAt: string | null
    paymentAttempts: number | null
    periodStart: string | null
    periodEnd: string | null
    dueDate: string | null
    collectionMethod: string | null
    lineItems: Array<{
      description: string
      amount: number
      quantity: number
    }> | null
  } | null
  
  // Plan/Product info
  planName: string | null
  productId: string | null
  scansPerDay: number | null
  billingInterval: string | null
  billingIntervalCount: number | null
  amount: number | null
  
  // Collection & Billing
  collectionMethod: string | null
  nextBillingDate: string | null
  liveMode: boolean
  
  // Dates
  customerCreatedAt: string | null
  
  // Stripe IDs
  stripeCustomerId: string
  stripeSubscriptionId: string
  stripePaymentMethodId: string | null
  
  // Trial info
  hasTrialPeriod: boolean
  isOnTrial: boolean
}

interface BillingVerificationModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  email: string
  onVerified: (data: SensitiveBillingData) => void
}

export function BillingVerificationModal({ open, onOpenChange, email, onVerified }: BillingVerificationModalProps) {
  const { toast } = useToast()
  const [code, setCode] = useState("")
  const [loading, setLoading] = useState(false)
  const [resending, setResending] = useState(false)
  const [userContinued, setUserContinued] = useState(false)
  const hasSentEmail = useRef(false)

  // Reset state when modal closes
  useEffect(() => {
    if (!open) {
      setUserContinued(false)
      hasSentEmail.current = false
    }
  }, [open])

  const handleContinue = async () => {
    setUserContinued(true)

    try {
      await fetch("/api/v2/billing/verify/send", { method: "POST" })
    } catch {
      toast({
        title: "Error sending code",
        description: "Please check your connection and try again",
        variant: "destructive",
      })
    }
  }

  const handleResendCode = async () => {
    setResending(true)
    try {
      const response = await fetch("/api/v2/billing/verify/send", { method: "POST" })
      if (!response.ok) {
        toast({
          title: "Error",
          description: "Failed to resend verification code",
          variant: "destructive",
        })
        return
      }
      toast({
        title: "Code resent",
        description: `A new verification code has been sent to ${email}`,
      })
    } catch {
      toast({
        title: "Error",
        description: "Failed to resend verification code",
        variant: "destructive",
      })
    } finally {
      setResending(false)
    }
  }

  const handleVerifyCode = async () => {
    if (!code.trim()) {
      toast({
        title: "Required",
        description: "Please enter the verification code",
        variant: "destructive",
      })
      return
    }

    setLoading(true)
    try {
      const response = await fetch("/api/v2/billing/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      })

      if (!response.ok) {
        const error = await response.json()
        toast({
          title: "Verification failed",
          description: error.error || "Please check the code and try again",
          variant: "destructive",
        })
        return
      }

      const data = await response.json()
      
      toast({
        title: "Verified",
        description: "Your billing information is now visible",
      })
      setCode("")
      hasSentEmail.current = false
      onOpenChange(false)
      onVerified(data.sensitiveData)
    } catch {
      toast({
        title: "Verification failed",
        description: "Please check the code and try again",
        variant: "destructive",
      })
    } finally {
      setLoading(false)
    }
  }

  const handleClose = () => {
    setCode("")
    setUserContinued(false)
    hasSentEmail.current = false
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-sm">
        {!userContinued ? (
          // Initial confirmation prompt
          <>
            <DialogHeader className="gap-2">
              <div className="flex items-center gap-2">
                <ShieldAlert className="h-5 w-5 text-amber-500" />
                <DialogTitle>Verify Your Identity</DialogTitle>
              </div>
              <DialogDescription>
                A verification code will be sent to your email address
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50 border border-border">
                <Mail className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground font-medium">Sending to</p>
                  <p className="text-sm font-medium text-foreground truncate">{email}</p>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <Button onClick={handleContinue} className="w-full">
                  Continue
                </Button>
                <Button variant="outline" onClick={handleClose} className="w-full">
                  Cancel
                </Button>
              </div>
            </div>
          </>
        ) : (
          // Code input area (shown after user clicks Continue)
          <>
            <DialogHeader className="gap-2">
              <div className="flex items-center gap-2">
                <ShieldAlert className="h-5 w-5 text-amber-500" />
                <DialogTitle>Enter Verification Code</DialogTitle>
              </div>
              <DialogDescription>
                Check your email for the 6-digit code
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-foreground">
                    6-digit code
                  </label>
                  <span className="text-xs text-muted-foreground">Expires in 5 min</span>
                </div>
                <Input
                  placeholder="000000"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  maxLength={6}
                  className="font-mono text-center text-2xl tracking-widest"
                  disabled={loading}
                  autoFocus
                />
              </div>

              <div className="flex flex-col gap-2">
                <Button
                  onClick={handleVerifyCode}
                  disabled={loading || code.length !== 6}
                  className="w-full"
                >
                  {loading ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Verifying...
                    </>
                  ) : (
                    "Verify Code"
                  )}
                </Button>
                <Button variant="outline" onClick={handleClose} disabled={loading} className="w-full">
                  Cancel
                </Button>
              </div>

              <button
                onClick={handleResendCode}
                disabled={loading || resending}
                className="w-full text-sm text-muted-foreground hover:text-foreground underline py-2 disabled:opacity-50"
              >
                {resending ? (
                  <>
                    <Loader2 className="h-4 w-4 inline mr-1 animate-spin" />
                    Sending...
                  </>
                ) : (
                  "Didn't receive the code? Send again"
                )}
              </button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

export type { SensitiveBillingData }
