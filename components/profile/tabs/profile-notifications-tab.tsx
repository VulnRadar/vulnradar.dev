"use client"

import { useState, useEffect } from "react"
import { Bell, Mail, Smartphone, MessageSquare, Loader2, Check, ExternalLink } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card } from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import { toast } from "sonner"
import { API } from "@/lib/config/constants"
import { useProfile } from "../profile-context"

interface NotificationSetting {
  id: string
  label: string
  description: string
  key: keyof typeof defaultSettings
}

const defaultSettings = {
  emailScanComplete: true,
  emailSecurityAlerts: true,
  emailWeeklyDigest: false,
  emailProductUpdates: false,
  pushEnabled: false,
  slackEnabled: false,
  slackWebhook: "",
}

const EMAIL_SETTINGS: NotificationSetting[] = [
  {
    id: "scan-complete",
    label: "Scan Complete",
    description: "Get notified when your scans finish",
    key: "emailScanComplete",
  },
  {
    id: "security-alerts",
    label: "Security Alerts",
    description: "Receive alerts for critical vulnerabilities",
    key: "emailSecurityAlerts",
  },
  {
    id: "weekly-digest",
    label: "Weekly Digest",
    description: "Summary of your security posture",
    key: "emailWeeklyDigest",
  },
  {
    id: "product-updates",
    label: "Product Updates",
    description: "New features and improvements",
    key: "emailProductUpdates",
  },
]

export function ProfileNotificationsTab() {
  const { notificationSettings, setNotificationSettings } = useProfile()

  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [slackWebhookInput, setSlackWebhookInput] = useState("")

  useEffect(() => {
    fetchSettings()
  }, [])

  const fetchSettings = async () => {
    try {
      setIsLoading(true)
      const res = await fetch(`${API.ME}/notifications`, { credentials: "include" })
      if (res.ok) {
        const data = await res.json()
        setNotificationSettings(data)
        setSlackWebhookInput(data.slackWebhook || "")
      }
    } catch (error) {
      console.error("Failed to fetch notification settings:", error)
    } finally {
      setIsLoading(false)
    }
  }

  const updateSetting = async (key: string, value: boolean | string) => {
    const newSettings = { ...notificationSettings, [key]: value }
    setNotificationSettings(newSettings)

    try {
      const res = await fetch(`${API.ME}/notifications`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ [key]: value }),
      })

      if (!res.ok) {
        // Revert on failure
        setNotificationSettings(notificationSettings)
        toast.error("Failed to update setting")
      }
    } catch (error) {
      setNotificationSettings(notificationSettings)
      toast.error("Failed to update setting")
    }
  }

  const handleSaveSlackWebhook = async () => {
    setIsSaving(true)
    try {
      const res = await fetch(`${API.ME}/notifications`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ slackWebhook: slackWebhookInput }),
      })

      if (res.ok) {
        setNotificationSettings({ ...notificationSettings, slackWebhook: slackWebhookInput })
        toast.success("Slack webhook saved")
      } else {
        toast.error("Failed to save webhook")
      }
    } catch (error) {
      toast.error("Failed to save webhook")
    } finally {
      setIsSaving(false)
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
      {/* Email Notifications */}
      <Card className="p-4 sm:p-6 border-border/50 bg-card/50">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-lg bg-primary/10">
            <Mail className="h-4 w-4 text-primary" />
          </div>
          <div>
            <h3 className="text-sm font-medium text-foreground">Email Notifications</h3>
            <p className="text-xs text-muted-foreground">Manage what emails you receive</p>
          </div>
        </div>

        <div className="space-y-4">
          {EMAIL_SETTINGS.map((setting) => (
            <div
              key={setting.id}
              className="flex items-center justify-between p-3 rounded-lg bg-muted/30 border border-border/50"
            >
              <div>
                <p className="text-sm font-medium text-foreground">{setting.label}</p>
                <p className="text-xs text-muted-foreground">{setting.description}</p>
              </div>
              <Switch
                checked={notificationSettings[setting.key] as boolean}
                onCheckedChange={(checked) => updateSetting(setting.key, checked)}
              />
            </div>
          ))}
        </div>
      </Card>

      {/* Push Notifications */}
      <Card className="p-4 sm:p-6 border-border/50 bg-card/50">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Smartphone className="h-4 w-4 text-primary" />
            </div>
            <div>
              <h3 className="text-sm font-medium text-foreground">Push Notifications</h3>
              <p className="text-xs text-muted-foreground">Receive notifications in your browser</p>
            </div>
          </div>
          <Switch
            checked={notificationSettings.pushEnabled}
            onCheckedChange={(checked) => updateSetting("pushEnabled", checked)}
          />
        </div>

        {notificationSettings.pushEnabled && (
          <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/20">
            <p className="text-xs text-green-600 dark:text-green-400 flex items-center gap-2">
              <Check className="h-3.5 w-3.5" />
              Push notifications enabled for this browser
            </p>
          </div>
        )}
      </Card>

      {/* Slack Integration */}
      <Card className="p-4 sm:p-6 border-border/50 bg-card/50">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <MessageSquare className="h-4 w-4 text-primary" />
            </div>
            <div>
              <h3 className="text-sm font-medium text-foreground">Slack Integration</h3>
              <p className="text-xs text-muted-foreground">Send notifications to a Slack channel</p>
            </div>
          </div>
          <Switch
            checked={notificationSettings.slackEnabled}
            onCheckedChange={(checked) => updateSetting("slackEnabled", checked)}
          />
        </div>

        {notificationSettings.slackEnabled && (
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="slack-webhook" className="text-xs">Webhook URL</Label>
              <div className="flex gap-2">
                <Input
                  id="slack-webhook"
                  value={slackWebhookInput}
                  onChange={(e) => setSlackWebhookInput(e.target.value)}
                  placeholder="https://hooks.slack.com/services/..."
                  className="bg-background"
                />
                <Button
                  onClick={handleSaveSlackWebhook}
                  disabled={isSaving || slackWebhookInput === notificationSettings.slackWebhook}
                  size="sm"
                >
                  {isSaving ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Check className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              <a
                href="https://api.slack.com/messaging/webhooks"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline inline-flex items-center gap-1"
              >
                Learn how to create a Slack webhook
                <ExternalLink className="h-3 w-3" />
              </a>
            </p>
          </div>
        )}
      </Card>
    </div>
  )
}
