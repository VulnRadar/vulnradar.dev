"use client"

import { useState, useEffect } from "react"
import { Lock, Eye, Database, Trash2, Download, Loader2, AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { toast } from "sonner"
import { API } from "@/lib/config/constants"
import { useProfile } from "../profile-context"
import { useRouter } from "next/navigation"

interface PrivacySetting {
  id: string
  label: string
  description: string
  key: keyof PrivacySettings
  icon: typeof Eye
}

interface PrivacySettings {
  profilePublic: boolean
  showEmail: boolean
  showSocialLinks: boolean
  allowDataCollection: boolean
  shareAnonymousData: boolean
}

const defaultSettings: PrivacySettings = {
  profilePublic: false,
  showEmail: false,
  showSocialLinks: true,
  allowDataCollection: true,
  shareAnonymousData: true,
}

const PRIVACY_SETTINGS: PrivacySetting[] = [
  {
    id: "profile-public",
    label: "Public Profile",
    description: "Allow others to view your profile",
    key: "profilePublic",
    icon: Eye,
  },
  {
    id: "show-email",
    label: "Show Email",
    description: "Display your email on your public profile",
    key: "showEmail",
    icon: Eye,
  },
  {
    id: "show-social",
    label: "Show Social Links",
    description: "Display your social links on your public profile",
    key: "showSocialLinks",
    icon: Eye,
  },
]

const DATA_SETTINGS: PrivacySetting[] = [
  {
    id: "data-collection",
    label: "Usage Analytics",
    description: "Help us improve by sharing usage data",
    key: "allowDataCollection",
    icon: Database,
  },
  {
    id: "anonymous-data",
    label: "Anonymous Statistics",
    description: "Share anonymous security statistics",
    key: "shareAnonymousData",
    icon: Database,
  },
]

export function ProfilePrivacyTab() {
  const router = useRouter()
  const { privacySettings, setPrivacySettings } = useProfile()

  const [isLoading, setIsLoading] = useState(true)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [deleteConfirmation, setDeleteConfirmation] = useState("")
  const [isDeleting, setIsDeleting] = useState(false)
  const [isExporting, setIsExporting] = useState(false)

  useEffect(() => {
    fetchSettings()
  }, [])

  const fetchSettings = async () => {
    try {
      setIsLoading(true)
      const res = await fetch(`${API.ME}/privacy`, { credentials: "include" })
      if (res.ok) {
        const data = await res.json()
        setPrivacySettings(data)
      }
    } catch (error) {
      console.error("Failed to fetch privacy settings:", error)
    } finally {
      setIsLoading(false)
    }
  }

  const updateSetting = async (key: string, value: boolean) => {
    const newSettings = { ...privacySettings, [key]: value }
    setPrivacySettings(newSettings)

    try {
      const res = await fetch(`${API.ME}/privacy`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ [key]: value }),
      })

      if (!res.ok) {
        setPrivacySettings(privacySettings)
        toast.error("Failed to update setting")
      }
    } catch (error) {
      setPrivacySettings(privacySettings)
      toast.error("Failed to update setting")
    }
  }

  const handleExportData = async () => {
    setIsExporting(true)
    try {
      const res = await fetch(`${API.ME}/export`, {
        method: "POST",
        credentials: "include",
      })

      if (res.ok) {
        const blob = await res.blob()
        const url = window.URL.createObjectURL(blob)
        const a = document.createElement("a")
        a.href = url
        a.download = "vulnradar-data-export.json"
        document.body.appendChild(a)
        a.click()
        window.URL.revokeObjectURL(url)
        document.body.removeChild(a)
        toast.success("Data exported successfully")
      } else {
        toast.error("Failed to export data")
      }
    } catch (error) {
      toast.error("Failed to export data")
    } finally {
      setIsExporting(false)
    }
  }

  const handleDeleteAccount = async () => {
    if (deleteConfirmation !== "DELETE") {
      toast.error("Please type DELETE to confirm")
      return
    }

    setIsDeleting(true)
    try {
      const res = await fetch(API.ME, {
        method: "DELETE",
        credentials: "include",
      })

      if (res.ok) {
        toast.success("Account deleted")
        router.push("/")
      } else {
        toast.error("Failed to delete account")
      }
    } catch (error) {
      toast.error("Failed to delete account")
    } finally {
      setIsDeleting(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Profile Privacy */}
      <Card className="p-4 sm:p-6 border-border/50 bg-card/50">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-lg bg-primary/10">
            <Eye className="h-4 w-4 text-primary" />
          </div>
          <div>
            <h3 className="text-sm font-medium text-foreground">Profile Privacy</h3>
            <p className="text-xs text-muted-foreground">Control who can see your information</p>
          </div>
        </div>

        <div className="space-y-3">
          {PRIVACY_SETTINGS.map((setting) => (
            <div
              key={setting.id}
              className="flex items-center justify-between p-3 rounded-lg bg-muted/30 border border-border/50"
            >
              <div>
                <p className="text-sm font-medium text-foreground">{setting.label}</p>
                <p className="text-xs text-muted-foreground">{setting.description}</p>
              </div>
              <Switch
                checked={privacySettings[setting.key] as boolean}
                onCheckedChange={(checked) => updateSetting(setting.key, checked)}
              />
            </div>
          ))}
        </div>
      </Card>

      {/* Data & Analytics */}
      <Card className="p-4 sm:p-6 border-border/50 bg-card/50">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-lg bg-primary/10">
            <Database className="h-4 w-4 text-primary" />
          </div>
          <div>
            <h3 className="text-sm font-medium text-foreground">Data & Analytics</h3>
            <p className="text-xs text-muted-foreground">Control how your data is used</p>
          </div>
        </div>

        <div className="space-y-3">
          {DATA_SETTINGS.map((setting) => (
            <div
              key={setting.id}
              className="flex items-center justify-between p-3 rounded-lg bg-muted/30 border border-border/50"
            >
              <div>
                <p className="text-sm font-medium text-foreground">{setting.label}</p>
                <p className="text-xs text-muted-foreground">{setting.description}</p>
              </div>
              <Switch
                checked={privacySettings[setting.key] as boolean}
                onCheckedChange={(checked) => updateSetting(setting.key, checked)}
              />
            </div>
          ))}
        </div>
      </Card>

      {/* Export Data */}
      <Card className="p-4 sm:p-6 border-border/50 bg-card/50">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Download className="h-4 w-4 text-primary" />
            </div>
            <div>
              <h3 className="text-sm font-medium text-foreground">Export Your Data</h3>
              <p className="text-xs text-muted-foreground">Download all your data in JSON format</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={handleExportData} disabled={isExporting}>
            {isExporting ? (
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
            ) : (
              <Download className="h-3.5 w-3.5 mr-1.5" />
            )}
            Export
          </Button>
        </div>
      </Card>

      {/* Delete Account */}
      <Card className="p-4 sm:p-6 border-destructive/50 bg-destructive/5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-destructive/10">
              <Trash2 className="h-4 w-4 text-destructive" />
            </div>
            <div>
              <h3 className="text-sm font-medium text-destructive">Delete Account</h3>
              <p className="text-xs text-muted-foreground">Permanently delete your account and all data</p>
            </div>
          </div>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setShowDeleteDialog(true)}
          >
            <Trash2 className="h-3.5 w-3.5 mr-1.5" />
            Delete
          </Button>
        </div>
      </Card>

      {/* Delete Confirmation Dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-destructive flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" />
              Delete Account
            </DialogTitle>
            <DialogDescription>
              This action cannot be undone. This will permanently delete your account, all your scan history, API keys, and remove your data from our servers.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20">
              <p className="text-xs text-destructive">
                <strong>Warning:</strong> You will lose access to:
              </p>
              <ul className="text-xs text-destructive mt-2 space-y-1 list-disc list-inside">
                <li>All scan history and results</li>
                <li>API keys and webhooks</li>
                <li>Team memberships</li>
                <li>Shared reports</li>
              </ul>
            </div>

            <div className="space-y-2">
              <Label htmlFor="delete-confirm" className="text-xs">
                Type <strong>DELETE</strong> to confirm
              </Label>
              <Input
                id="delete-confirm"
                value={deleteConfirmation}
                onChange={(e) => setDeleteConfirmation(e.target.value)}
                placeholder="DELETE"
                className="bg-background"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteDialog(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteAccount}
              disabled={isDeleting || deleteConfirmation !== "DELETE"}
            >
              {isDeleting ? (
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4 mr-1.5" />
              )}
              Delete Account
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
