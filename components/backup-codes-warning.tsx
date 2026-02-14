"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import useSWR from "swr"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { AlertTriangle } from "lucide-react"

export function BackupCodesWarning() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  const { data: me } = useSWR("/api/auth/me", (url: string) =>
    fetch(url).then((r) => r.json()),
    { revalidateOnFocus: false, dedupingInterval: 60000 },
  )

  useEffect(() => {
    if (me?.backupCodesInvalid && !dismissed) {
      setOpen(true)
    }
  }, [me?.backupCodesInvalid, dismissed])

  function handleDismiss() {
    setOpen(false)
    setDismissed(true)
  }

  function handleRotate() {
    setOpen(false)
    setDismissed(true)
    router.push("/profile")
  }

  if (!me?.backupCodesInvalid || dismissed) return null

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleDismiss() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-destructive/10">
              <AlertTriangle className="h-5 w-5 text-destructive" />
            </div>
            <div>
              <DialogTitle>Backup Codes Need Rotation</DialogTitle>
              <DialogDescription className="mt-1">
                Your existing backup codes are no longer valid.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <div className="flex flex-col gap-3 py-2">
          <p className="text-sm text-muted-foreground leading-relaxed">
            We upgraded our security to hash all 2FA backup codes. Your old backup codes will no longer work. Please go to your profile and <span className="font-medium text-foreground">regenerate your backup codes</span> to get new ones.
          </p>
          <div className="rounded-lg bg-destructive/5 border border-destructive/20 px-3 py-2.5">
            <p className="text-xs text-destructive font-medium">
              Until you regenerate, you will not be able to use backup codes to log in if you lose access to your authenticator app.
            </p>
          </div>
        </div>
        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button variant="outline" onClick={handleDismiss} className="bg-transparent">
            Remind Me Later
          </Button>
          <Button onClick={handleRotate}>
            Rotate Backup Codes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
