"use client"

import { useState } from "react"
import { AlertTriangle, ShieldCheck, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface ConfirmDialogProps {
  open: boolean
  title: string
  description: string
  confirmLabel: string
  danger?: boolean
  onConfirm: () => void | Promise<void>
  onCancel: () => void
  children?: React.ReactNode
}

export function ConfirmDialog({ 
  open, 
  title, 
  description, 
  confirmLabel, 
  danger, 
  onConfirm, 
  onCancel, 
  children 
}: ConfirmDialogProps) {
  const [isLoading, setIsLoading] = useState(false)
  
  if (!open) return null
  
  const handleConfirm = async () => {
    setIsLoading(true)
    try {
      await onConfirm()
    } catch {
      // Error handling is done in the action itself
    } finally {
      setIsLoading(false)
    }
  }
  
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in">
      <div className="bg-card border border-border rounded-xl p-6 w-full max-w-md mx-4 shadow-2xl animate-in zoom-in-95">
        <div className="flex items-start gap-3 mb-3">
          <div className={cn(
            "h-10 w-10 rounded-lg flex items-center justify-center shrink-0", 
            danger ? "bg-destructive/10" : "bg-primary/10"
          )}>
            {danger 
              ? <AlertTriangle className="h-5 w-5 text-destructive" /> 
              : <ShieldCheck className="h-5 w-5 text-primary" />
            }
          </div>
          <div>
            <h3 className="text-lg font-semibold text-foreground">{title}</h3>
            <p className="text-sm text-muted-foreground mt-1 leading-relaxed">{description}</p>
          </div>
        </div>
        {children}
        <div className="flex items-center justify-end gap-2 mt-5 pt-4 border-t border-border">
          <Button variant="ghost" onClick={onCancel} disabled={isLoading}>
            Cancel
          </Button>
          <Button
            className={danger ? "bg-destructive hover:bg-destructive/90 text-destructive-foreground" : ""}
            onClick={handleConfirm}
            disabled={isLoading}
          >
            {isLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}
