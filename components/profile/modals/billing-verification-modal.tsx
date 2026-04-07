"use client"

import { useState } from "react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Loader2, Mail, ShieldAlert } from "lucide-react"
import { useToast } from "@/components/ui/use-toast"

interface BillingVerificationModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  email: string
  onVerified: () => void
}

export function BillingVerificationModal({ open, onOpenChange, email, onVerified }: BillingVerificationModalProps) {
  const { toast } = useToast()
  const [step, setStep] = useState<"request" | "verify">("request")
  const [code, setCode] = useState("")
  const [loading, setLoading] = useState(false)
  const [codeSent, setCodeSent] = useState(false)

  const handleRequestCode = async () => {
    setLoading(true)
    try {
      const response = await fetch("/api/v2/billing/verify/send", {
        method: "POST",
      })

      if (!response.ok) {
        throw new Error("Failed to send verification code")
      }

      setStep("verify")
      setCodeSent(true)
      toast({
        title: "Code sent",
        description: `A verification code has been sent to ${email}`,
      })
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to send verification code. Please try again.",
        variant: "destructive",
      })
    } finally {
      setLoading(false)
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
        throw new Error(error.message || "Invalid verification code")
      }

      toast({
        title: "Verified",
        description: "Your billing information has been verified",
      })
      setCode("")
      setStep("request")
      setCodeSent(false)
      onOpenChange(false)
      onVerified()
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
    setStep("request")
    setCodeSent(false)
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
            We need to verify your identity to display sensitive billing information
          </DialogDescription>
        </DialogHeader>

        {step === "request" ? (
          <div className="space-y-4">
            <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 p-3 flex gap-3">
              <Mail className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-amber-700 dark:text-amber-300">
                A verification code will be sent to <strong>{email}</strong>
              </p>
            </div>

            <Button onClick={handleRequestCode} disabled={loading} className="w-full">
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Sending...
                </>
              ) : (
                "Send Verification Code"
              )}
            </Button>

            <Button variant="outline" onClick={handleClose} disabled={loading} className="w-full">
              Cancel
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="text-sm text-muted-foreground">
              Enter the 6-digit code sent to your email. It expires in 5 minutes.
            </div>

            <Input
              placeholder="000000"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              maxLength={6}
              className="font-mono text-center text-lg tracking-widest"
              disabled={loading}
            />

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
              onClick={() => {
                setStep("request")
                setCodeSent(false)
                setCode("")
              }}
              disabled={loading}
              className="w-full text-sm text-muted-foreground hover:text-foreground underline"
            >
              Didn&apos;t receive the code? Send again
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
