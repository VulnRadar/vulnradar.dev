"use client"

import React, { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { AlertCircle, Save, RefreshCw } from "lucide-react"
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

  const hasChanges = Object.keys(changes).length > 0

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

          {hasChanges && (
            <div className="mt-6 pt-6 border-t border-border">
              <Button onClick={handleSave} disabled={saving} className="w-full">
                <Save className="h-4 w-4 mr-2" />
                {saving ? "Saving..." : "Save Changes"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
