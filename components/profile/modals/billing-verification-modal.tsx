"use client"

import { useState, useEffect, useRef } from "react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Loader2, Mail, ShieldAlert, CheckCircle } from "lucide-react"
import { useToast } from "@/components/ui/use-toast"

interface SensitiveBillingData {
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
  customer: {
    email: string | null
    name: string | null
    phone: string | null
    address: {
      line1?: string
      line2?: string
      city?: string
      state?: string
      postal_code?: string
      country?: string
    } | null
  }
  paymentMethod: {
    cardBrand: string | null
    cardLast4: string | null
    cardExpMonth: number | null
    cardExpYear: number | null
    cardFunding: string | null
    cardCountry: string | null
    billingName: string | null
    billingEmail: string | null
    billingPhone: string | null
    billingAddress: {
      line1?: string
      line2?: string
      city?: string
      state?: string
      postal_code?: string
      country?: string
    } | null
  } | null
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
  } | null
  stripeCustomerId: string
  stripeSubscriptionId: string
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
  const [sendingEmail, setSendingEmail] = useState(false)
  const [emailSent, setEmailSent] = useState(false)
  const [resending, setResending] = useState(false)
  const hasSentEmail = useRef(false)

  // Send email in background immediately when modal opens
  useEffect(() => {
    if (open && !hasSentEmail.current) {
      hasSentEmail.current = true
      setSendingEmail(true)
      
      fetch("/api/v2/billing/verify/send", { method: "POST" })
        .then((res) => {
          if (res.ok) {
            setEmailSent(true)
          } else {
            toast({
              title: "Error sending code",
              description: "Please try again or contact support",
              variant: "destructive",
            })
          }
        })
        .catch(() => {
          toast({
            title: "Error sending code",
            description: "Please check your connection and try again",
            variant: "destructive",
          })
        })
        .finally(() => {
          setSendingEmail(false)
        })
    }
  }, [open, toast])

  const handleResendCode = async () => {
    setResending(true)
    try {
      const response = await fetch("/api/v2/billing/verify/send", { method: "POST" })
      if (response.ok) {
        setEmailSent(true)
        toast({
          title: "Code resent",
          description: `A new verification code has been sent to ${email}`,
        })
      } else {
        throw new Error("Failed to resend")
      }
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
        throw new Error(error.error || "Invalid verification code")
      }

      const data = await response.json()
      
      toast({
        title: "Verified",
        description: "Your billing information is now visible",
      })
      setCode("")
      hasSentEmail.current = false
      setEmailSent(false)
      onOpenChange(false)
      onVerified(data.sensitiveData)
    } catch (error) {
      toast({
        title: "Verification failed",
        description: error instanceof Error ? error.message : "Please check the code and try again",
        variant: "destructive",
      })
    } finally {
      setLoading(false)
    }
  }

  const handleClose = () => {
    setCode("")
    hasSentEmail.current = false
    setEmailSent(false)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-amber-500" />
            <DialogTitle>Verify Your Identity</DialogTitle>
          </div>
          <DialogDescription>
            Enter the verification code sent to your email
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-lg bg-muted/50 border border-border p-3 flex gap-3">
            {sendingEmail ? (
              <>
                <Loader2 className="h-5 w-5 text-primary flex-shrink-0 mt-0.5 animate-spin" />
                <p className="text-sm text-muted-foreground">
                  Sending verification code to <strong className="text-foreground">{email}</strong>...
                </p>
              </>
            ) : emailSent ? (
              <>
                <CheckCircle className="h-5 w-5 text-emerald-500 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-muted-foreground">
                  Code sent to <strong className="text-foreground">{email}</strong>
                </p>
              </>
            ) : (
              <>
                <Mail className="h-5 w-5 text-muted-foreground flex-shrink-0 mt-0.5" />
                <p className="text-sm text-muted-foreground">
                  Verification code will be sent to <strong className="text-foreground">{email}</strong>
                </p>
              </>
            )}
          </div>

          <div>
            <label className="text-sm text-muted-foreground mb-2 block">
              Enter 6-digit code (expires in 5 minutes)
            </label>
            <Input
              placeholder="000000"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              maxLength={6}
              className="font-mono text-center text-lg tracking-widest"
              disabled={loading}
              autoFocus
            />
          </div>

          <Button onClick={handleVerifyCode} disabled={loading || code.length !== 6} className="w-full">
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

          <button
            onClick={handleResendCode}
            disabled={loading || resending || sendingEmail}
            className="w-full text-sm text-muted-foreground hover:text-foreground underline disabled:opacity-50"
          >
            {resending ? "Sending..." : "Didn't receive the code? Send again"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export type { SensitiveBillingData }
