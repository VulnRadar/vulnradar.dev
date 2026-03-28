"use client"

import React, { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { AlertCircle, Save, RefreshCw, Loader2, CheckCircle2, X } from "lucide-react"
import { SaveConfirmationModal, type ChangeItem } from "@/components/save-confirmation-modal"
import { cn } from "@/lib/utils"

interface SystemSetting {
  key: string
  value: string
  description?: string
  updated_at?: string
}

const defaultSettings = [
  {
    key: "maintenance_mode",
    label: "Maintenance Mode",
    description: "Disable access for regular users while maintenance is in progress",
    type: "toggle",
  },
  {
    key: "maintenance_message",
    label: "Maintenance Message",
    description: "Message displayed to users during maintenance mode",
    type: "text",
  },
]

export function SystemSettingsManager() {
  const [settings, setSettings] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [changes, setChanges] = useState<Record<string, string>>({})
  const [showSaveModal, setShowSaveModal] = useState(false)

  const fetchSettings = async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/v2/admin/features", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "list", section: "system_settings" }),
      })
      const data = await res.json()
      const settingsMap: Record<string, string> = {}
      data.settings?.forEach((s: SystemSetting) => {
        settingsMap[s.key] = s.value
      })
      setSettings(settingsMap)
      setChanges({})
    } catch (error) {
      console.error("Error fetching settings:", error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchSettings()
  }, [])

  const handleChange = (key: string, value: string) => {
    setChanges((prev) => ({
      ...prev,
      [key]: value,
    }))
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      for (const [key, value] of Object.entries(changes)) {
        await fetch("/api/v2/admin/features", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "set",
            section: "system_settings",
            key,
            value,
          }),
        })
      }
      setSettings((prev) => ({
        ...prev,
        ...changes,
      }))
      setChanges({})
    } catch (error) {
      console.error("Error saving settings:", error)
    } finally {
      setSaving(false)
    }
  }

  const discardChanges = () => {
    setChanges({})
  }

  const hasChanges = Object.keys(changes).length > 0

  // Build change items for modal
  const modalChanges: ChangeItem[] = Object.entries(changes).map(([key, value]) => {
    const setting = defaultSettings.find((s) => s.key === key)
    const oldValue = settings[key] || ""
    return {
      field: key,
      label: setting?.label || key,
      oldValue: setting?.type === "toggle" ? (oldValue === "true" ? "Enabled" : "Disabled") : oldValue,
      newValue: setting?.type === "toggle" ? (value === "true" ? "Enabled" : "Disabled") : value,
    }
  })

  return (
    <div className="space-y-6">
      {/* Maintenance Mode Alert */}
      {settings.maintenance_mode === "true" && (
        <Card className="border-yellow-500/20 bg-yellow-500/10">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <AlertCircle className="h-5 w-5 text-yellow-600 flex-shrink-0" />
              <div>
                <p className="font-semibold text-yellow-900">Maintenance Mode Active</p>
                <p className="text-sm text-yellow-800 mt-1">
                  Regular users cannot access the application
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Settings Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>System Settings</CardTitle>
              <CardDescription>Configure global system behavior</CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={fetchSettings}
              disabled={loading}
            >
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-6">
            {defaultSettings.map((setting) => {
              const value = changes[setting.key] ?? settings[setting.key] ?? ""

              return (
                <div key={setting.key} className="border-b border-border pb-6 last:border-0">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <label className="font-medium text-sm">{setting.label}</label>
                      {setting.description && (
                        <p className="text-xs text-muted-foreground mt-1">
                          {setting.description}
                        </p>
                      )}
                    </div>
                  </div>

                  {setting.type === "toggle" ? (
                    <div className="flex items-center gap-3">
                      <Switch
                        checked={value === "true"}
                        onCheckedChange={(checked) =>
                          handleChange(setting.key, checked ? "true" : "false")
                        }
                      />
                      <span className="text-sm text-muted-foreground">
                        {value === "true" ? "Enabled" : "Disabled"}
                      </span>
                    </div>
                  ) : (
                    <Input
                      type={setting.type}
                      value={value}
                      onChange={(e) => handleChange(setting.key, e.target.value)}
                      placeholder={`Enter ${setting.label.toLowerCase()}`}
                    />
                  )}
                </div>
              )
            })}
          </div>

        </CardContent>
      </Card>

      {/* Floating save bar */}
      {hasChanges && (
        <div className="fixed bottom-0 left-0 right-0 z-50 p-4 pointer-events-none">
          <div className="max-w-lg mx-auto pointer-events-auto">
            <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg bg-card border border-border shadow-lg">
              <div className="flex items-center gap-3">
                <Save className="h-4 w-4 text-primary" />
                <p className="text-sm font-medium text-foreground">
                  {modalChanges.length} unsaved change{modalChanges.length !== 1 ? "s" : ""}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={discardChanges} disabled={saving}>
                  <X className="h-3.5 w-3.5 mr-1" />
                  Discard
                </Button>
                <Button size="sm" className="gap-1.5" onClick={() => setShowSaveModal(true)} disabled={saving}>
                  {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                  Save Changes
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Save confirmation modal */}
      <SaveConfirmationModal
        isOpen={showSaveModal}
        onClose={() => setShowSaveModal(false)}
        onConfirm={async () => {
          await handleSave()
          setShowSaveModal(false)
        }}
        title="Save System Settings"
        description="Review and confirm changes to system configuration."
        changes={modalChanges}
        loading={saving}
        confirmText="Save Settings"
      />
    </div>
  )
}
