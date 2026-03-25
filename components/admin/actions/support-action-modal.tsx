"use client"

import { useState } from "react"
import { AlertTriangle, ShieldCheck, Loader2, Bell, BellOff } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface SupportActionModalProps {
  open: boolean
  title: string
  description: string
  confirmLabel: string
  danger?: boolean
  showNotifyOption?: boolean
  onConfirm: (notifyUser: boolean) => void | Promise<void>
  onCancel: () => void
  children?: React.ReactNode
}

export function SupportActionModal({ 
  open, 
  title, 
  description, 
  confirmLabel, 
  danger, 
  showNotifyOption = true,
  onConfirm, 
  onCancel, 
  children 
}: SupportActionModalProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [notifyUser, setNotifyUser] = useState(true)
  
  if (!open) return null
  
  const handleConfirm = async (notify: boolean) => {
    setIsLoading(true)
    try {
      await onConfirm(notify)
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

        {/* Notify User Option */}
        {showNotifyOption && (
          <div className="mt-4 p-3 rounded-lg bg-muted/30 border border-border">
            <button
              onClick={() => setNotifyUser(!notifyUser)}
              className="flex items-center gap-3 w-full text-left"
            >
              <div className={cn(
                "h-8 w-8 rounded-lg flex items-center justify-center shrink-0 transition-colors",
                notifyUser ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
              )}>
                {notifyUser ? <Bell className="h-4 w-4" /> : <BellOff className="h-4 w-4" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground">
                  {notifyUser ? "Notify user via email" : "Don't notify user"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {notifyUser 
                    ? "User will receive an email about this action" 
                    : "Action will be performed silently"
                  }
                </p>
              </div>
              <div className={cn(
                "h-5 w-9 rounded-full transition-colors relative",
                notifyUser ? "bg-primary" : "bg-muted"
              )}>
                <div className={cn(
                  "absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform",
                  notifyUser ? "translate-x-4" : "translate-x-0.5"
                )} />
              </div>
            </button>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 mt-5 pt-4 border-t border-border">
          <Button variant="ghost" onClick={onCancel} disabled={isLoading}>
            Cancel
          </Button>
          <Button
            className={danger ? "bg-destructive hover:bg-destructive/90 text-destructive-foreground" : ""}
            onClick={() => handleConfirm(notifyUser)}
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
