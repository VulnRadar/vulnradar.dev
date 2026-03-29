"use client"

import * as React from "react"
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Loader2, Check, AlertTriangle, ArrowRight, Mail, Clock, User } from "lucide-react"
import { cn } from "@/lib/utils"
import { transitions, backdrops } from "@/lib/animations"

export interface ChangeItem {
  field: string
  label: string
  oldValue: string | number | boolean | null | undefined
  newValue: string | number | boolean | null | undefined
}

export interface AffectedUser {
  id: number | string
  email: string
  name?: string
}

export interface SaveConfirmationModalProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: (notifyUser?: boolean) => Promise<void>
  title: string
  description?: string
  changes: ChangeItem[]
  loading?: boolean
  isAdminAction?: boolean
  affectedUser?: AffectedUser
  confirmText?: string
  cancelText?: string
  variant?: "default" | "destructive"
  /** Force email notification on with no toggle (for support actions) */
  forceNotify?: boolean
}

function formatValue(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return "—"
  if (typeof value === "boolean") return value ? "Yes" : "No"
  if (typeof value === "number") return value.toString()
  if (value === "") return "—"
  return String(value)
}

export function SaveConfirmationModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  description,
  changes,
  loading = false,
  isAdminAction = false,
  affectedUser,
  confirmText = "Save Changes",
  cancelText = "Cancel",
  variant = "default",
  forceNotify = false,
}: SaveConfirmationModalProps) {
  const [notifyUser, setNotifyUser] = React.useState(true)
  const [success, setSuccess] = React.useState(false)

  // Detect if account-related fields are being changed
  const emailChange = changes.find(c => c.field === "Email Address" || c.field === "email" || c.label?.toLowerCase().includes("email"))
  const isEmailChanging = emailChange && formatValue(emailChange.oldValue) !== formatValue(emailChange.newValue)
  
  const nameChange = changes.find(c => c.field === "Display Name" || c.field === "name" || c.label?.toLowerCase().includes("name"))
  const isNameChanging = nameChange && formatValue(nameChange.oldValue) !== formatValue(nameChange.newValue)
  
  const planChange = changes.find(c => c.field === "Subscription Plan" || c.field === "plan" || c.label?.toLowerCase().includes("plan") || c.label?.toLowerCase().includes("subscription"))
  const isPlanChanging = planChange && formatValue(planChange.oldValue) !== formatValue(planChange.newValue)
  
  // All account changes (email, name, plan) require notification when admin action
  const requireNotification = isAdminAction && (isEmailChanging || isNameChanging || isPlanChanging)

  // Reset success state when modal opens
  React.useEffect(() => {
    if (isOpen) {
      setSuccess(false)
      // Auto-enable notification for account changes
      if (requireNotification) {
        setNotifyUser(true)
      }
    }
  }, [isOpen, requireNotification])

  const handleConfirm = async () => {
    try {
      // Email changes require notification
      if (requireNotification && !notifyUser) {
        return // Don't allow save without notification for email changes
      }
      // forceNotify always sends true, otherwise use toggle state
      const shouldNotify = forceNotify || requireNotification ? true : (isAdminAction ? notifyUser : undefined)
      await onConfirm(shouldNotify)
      setSuccess(true)
      setTimeout(() => {
        setSuccess(false)
        onClose()
      }, 1500)
    } catch {
      // Error handling is done in the parent component
    }
  }

  const handleClose = () => {
    if (!loading) {
      setSuccess(false)
      onClose()
    }
  }

  // Filter out changes where old and new are the same
  const actualChanges = changes.filter(
    (c) => formatValue(c.oldValue) !== formatValue(c.newValue)
  )

  return (
    <AlertDialog open={isOpen} onOpenChange={handleClose}>
      <AlertDialogContent className={cn(
        "sm:max-w-md border-border/60",
        backdrops.card
      )}>
        {/* Success State */}
        {success ? (
          <div className="flex flex-col items-center justify-center py-8 animate-fade-in">
            <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
              <Check className="h-8 w-8 text-primary" />
            </div>
            <p className="text-lg font-medium">Changes Saved</p>
            {isAdminAction && notifyUser && affectedUser && (
              <div className="text-sm text-muted-foreground mt-2 text-center space-y-1">
                {isEmailChanging ? (
                  <>
                    <p>Notifications sent to:</p>
                    <p><span className="text-destructive">{emailChange?.oldValue}</span> (old)</p>
                    <p><span className="text-primary">{emailChange?.newValue}</span> (new)</p>
                  </>
                ) : (
                  <p>Notification sent to {affectedUser.email}</p>
                )}
              </div>
            )}
          </div>
        ) : (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                {variant === "destructive" && (
                  <AlertTriangle className="h-5 w-5 text-destructive" />
                )}
                {title}
              </AlertDialogTitle>
              {description && (
                <AlertDialogDescription>{description}</AlertDialogDescription>
              )}
            </AlertDialogHeader>

            {/* Affected User Info (Admin Actions) */}
            {isAdminAction && affectedUser && (
              <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50 border border-border/50">
                <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center">
                  <User className="h-4 w-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">
                    {affectedUser.name || "User"}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {affectedUser.email}
                  </p>
                </div>
              </div>
            )}

            {/* Changes List */}
            {actualChanges.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Changes to Apply
                </p>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {actualChanges.map((change, i) => (
                    <div
                      key={i}
                      className={cn(
                        "flex items-center gap-3 p-3 rounded-lg border border-border/50 bg-background",
                        transitions.default
                      )}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-muted-foreground mb-1">
                          {change.label}
                        </p>
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/20 font-normal text-xs">
                            {formatValue(change.oldValue)}
                          </Badge>
                          <ArrowRight className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                          <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20 font-normal text-xs">
                            {formatValue(change.newValue)}
                          </Badge>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Timestamp */}
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" />
              <span>
                {new Date().toLocaleDateString("en-US", {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </span>
            </div>

            {/* Notify User Toggle (Admin Actions) */}
            {isAdminAction && affectedUser && (
              <div className="space-y-2">
                <div className="flex items-center justify-between p-3 rounded-lg bg-blue-500/5 border border-blue-500/20">
                  <div className="flex items-center gap-2">
                    <Mail className="h-4 w-4 text-blue-500" />
                    <Label htmlFor="notify-user" className="text-sm cursor-pointer">
                      Notify user via email
                    </Label>
                  </div>
                  {forceNotify || requireNotification ? (
                    <Badge variant="outline" className="bg-blue-500/10 text-blue-500 border-blue-500/20 text-xs">
                      Required
                    </Badge>
                  ) : (
                    <Switch
                      id="notify-user"
                      checked={notifyUser}
                      onCheckedChange={setNotifyUser}
                    />
                  )}
                </div>
                
                {/* Account change notification info */}
                {requireNotification && (
                  <div className="text-xs text-muted-foreground p-3 rounded-lg bg-muted/50 border border-border/40">
                    {isEmailChanging ? (
                      <>
                        <p className="font-medium text-foreground mb-1">Email notification will be sent to:</p>
                        <ul className="space-y-1 ml-4">
                          <li>- <span className="text-destructive">{emailChange?.oldValue}</span> (old email)</li>
                          <li>- <span className="text-primary">{emailChange?.newValue}</span> (new email)</li>
                        </ul>
                        <p className="mt-2 text-[11px] italic">Both addresses will be notified for security purposes.</p>
                      </>
                    ) : (
                      <p>
                        The user will be notified at <span className="text-foreground font-medium">{affectedUser?.email}</span> about these account changes.
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}

            <AlertDialogFooter className="gap-2 sm:gap-0">
              <Button
                variant="outline"
                onClick={handleClose}
                disabled={loading}
                className={transitions.fast}
              >
                {cancelText}
              </Button>
              <Button
                variant={variant === "destructive" ? "destructive" : "default"}
                onClick={handleConfirm}
                disabled={loading || actualChanges.length === 0 || (requireNotification && !notifyUser)}
                className={cn("min-w-[120px]", transitions.fast)}
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Saving...
                  </>
                ) : (
                  confirmText
                )}
              </Button>
            </AlertDialogFooter>
          </>
        )}
      </AlertDialogContent>
    </AlertDialog>
  )
}
