"use client";

import React, { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Settings,
  AlertTriangle,
  Save,
  RefreshCw,
  Loader2,
  CheckCircle2,
  X,
  MessageSquare,
  Shield,
} from "lucide-react";
import {
  SaveConfirmationModal,
  type ChangeItem,
} from "@/components/shared/save-confirmation-modal";
import { cn } from "@/lib/ui/utils";

interface SystemSetting {
  key: string;
  value: string;
  description?: string;
  updated_at?: string;
}

const defaultSettings = [
  {
    key: "maintenance_mode",
    label: "Maintenance Mode",
    description:
      "Disable access for regular users while maintenance is in progress",
    type: "toggle",
    icon: Shield,
  },
  {
    key: "maintenance_message",
    label: "Maintenance Message",
    description: "Message displayed to users during maintenance mode",
    type: "text",
    icon: MessageSquare,
  },
];

export function SystemSettingsManager() {
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [changes, setChanges] = useState<Record<string, string>>({});
  const [showSaveModal, setShowSaveModal] = useState(false);

  const fetchSettings = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/v3/admin/features", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "list", section: "system_settings" }),
      });
      const data = await res.json();
      const settingsMap: Record<string, string> = {};
      data.settings?.forEach((s: SystemSetting) => {
        settingsMap[s.key] = s.value;
      });
      setSettings(settingsMap);
      setChanges({});
    } catch (error) {
      console.error("Error fetching settings:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSettings();
  }, []);

  const handleChange = (key: string, value: string) => {
    setChanges((prev) => ({
      ...prev,
      [key]: value,
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      for (const [key, value] of Object.entries(changes)) {
        await fetch("/api/v3/admin/features", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "set",
            section: "system_settings",
            key,
            value,
          }),
        });
      }
      setSettings((prev) => ({
        ...prev,
        ...changes,
      }));
      setChanges({});
    } catch (error) {
      console.error("Error saving settings:", error);
    } finally {
      setSaving(false);
    }
  };

  const discardChanges = () => {
    setChanges({});
  };

  const hasChanges = Object.keys(changes).length > 0;

  // Build change items for modal
  const modalChanges: ChangeItem[] = Object.entries(changes).map(
    ([key, value]) => {
      const setting = defaultSettings.find((s) => s.key === key);
      const oldValue = settings[key] || "";
      return {
        field: key,
        label: setting?.label || key,
        oldValue:
          setting?.type === "toggle"
            ? oldValue === "true"
              ? "Enabled"
              : "Disabled"
            : oldValue,
        newValue:
          setting?.type === "toggle"
            ? value === "true"
              ? "Enabled"
              : "Disabled"
            : value,
      };
    },
  );

  // Stats
  const maintenanceActive =
    (changes.maintenance_mode ?? settings.maintenance_mode) === "true";

  return (
    <div className="space-y-6">
      {/* Maintenance Mode Alert */}
      {maintenanceActive && (
        <div className="flex items-center gap-3 p-4 rounded-xl border border-amber-500/30 bg-amber-500/10">
          <div className="p-2 rounded-lg bg-amber-500/20">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
              Maintenance Mode Active
            </p>
            <p className="text-xs text-amber-800/80 dark:text-amber-300/80 mt-0.5">
              Regular users cannot access the application
            </p>
          </div>
        </div>
      )}

      {/* Settings Card */}
      <Card className="border-border/50 bg-card/50 overflow-hidden">
        <div className="px-4 sm:px-5 py-4 border-b border-border/50">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <Settings className="h-4 w-4 text-primary" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-foreground">
                  System Settings
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Configure global system behavior
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="gap-2 border-border/40 shrink-0"
              onClick={fetchSettings}
              disabled={loading}
            >
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
              <span className="hidden sm:inline">Refresh</span>
            </Button>
          </div>
        </div>

        <CardContent className="p-0">
          <div className="divide-y divide-border/40">
            {defaultSettings.map((setting) => {
              const value = changes[setting.key] ?? settings[setting.key] ?? "";
              const Icon = setting.icon;

              return (
                <div
                  key={setting.key}
                  className="px-4 sm:px-5 py-4 hover:bg-muted/20 transition-colors"
                >
                  <div className="flex items-start gap-3">
                    <div className="p-2 rounded-lg bg-muted/50 shrink-0 mt-0.5">
                      <Icon className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1">
                          <label className="text-sm font-medium text-foreground">
                            {setting.label}
                          </label>
                          {setting.description && (
                            <p className="text-xs text-muted-foreground mt-1">
                              {setting.description}
                            </p>
                          )}
                        </div>
                        {setting.type === "toggle" && (
                          <div className="flex items-center gap-2 shrink-0">
                            <span
                              className={cn(
                                "text-xs font-medium",
                                value === "true"
                                  ? "text-emerald-500"
                                  : "text-muted-foreground",
                              )}
                            >
                              {value === "true" ? "Enabled" : "Disabled"}
                            </span>
                            <Switch
                              checked={value === "true"}
                              onCheckedChange={(checked) =>
                                handleChange(
                                  setting.key,
                                  checked ? "true" : "false",
                                )
                              }
                            />
                          </div>
                        )}
                      </div>

                      {setting.type !== "toggle" && (
                        <div className="mt-3">
                          <Input
                            type={setting.type}
                            value={value}
                            onChange={(e) =>
                              handleChange(setting.key, e.target.value)
                            }
                            placeholder={`Enter ${setting.label.toLowerCase()}`}
                            className="h-10 bg-background/50 border-border/40 focus:border-primary/50"
                          />
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Floating save bar */}
      {hasChanges && (
        <div className="fixed bottom-0 left-0 right-0 z-50 p-4 pointer-events-none">
          <div className="max-w-lg mx-auto pointer-events-auto">
            <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-xl bg-card border border-border/50 shadow-lg backdrop-blur-sm">
              <div className="flex items-center gap-3">
                <div className="p-1.5 rounded-lg bg-primary/10">
                  <Save className="h-3.5 w-3.5 text-primary" />
                </div>
                <p className="text-sm font-medium text-foreground">
                  {modalChanges.length} unsaved change
                  {modalChanges.length !== 1 ? "s" : ""}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={discardChanges}
                  disabled={saving}
                  className="gap-1.5"
                >
                  <X className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Discard</span>
                </Button>
                <Button
                  size="sm"
                  className="gap-1.5"
                  onClick={() => setShowSaveModal(true)}
                  disabled={saving}
                >
                  {saving ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <CheckCircle2 className="h-3.5 w-3.5" />
                  )}
                  <span className="hidden sm:inline">Save Changes</span>
                  <span className="sm:hidden">Save</span>
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
          await handleSave();
          setShowSaveModal(false);
        }}
        title="Save System Settings"
        description="Review and confirm changes to system configuration."
        changes={modalChanges}
        loading={saving}
        confirmText="Save Settings"
      />
    </div>
  );
}
