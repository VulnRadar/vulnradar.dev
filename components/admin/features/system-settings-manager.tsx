"use client";

import React, {
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
} from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Settings,
  AlertTriangle,
  Save,
  RefreshCw,
  Loader2,
  CheckCircle2,
  X,
  Trash2,
  CheckCheck,
  Download,
  Upload,
  Info,
} from "lucide-react";
import {
  SaveConfirmationModal,
  type ChangeItem,
} from "@/components/shared/save-confirmation-modal";
import {
  ConfirmDialog,
  useUnsavedChangesWarning,
  AdminMobileToc,
  AdminMobileTocTrigger,
  SettingsFieldsSkeleton,
  type AdminTocItem,
} from "@/components/admin/shared";
import { cn } from "@/lib/ui/utils";
import { SETTINGS_REGISTRY, type SettingKey } from "@/lib/config/registry";
import {
  SETTINGS_TABS,
  FIELDS_BY_GROUP,
  tabHasBuildTierFields,
  formatFieldValue,
  isDestructiveToggle,
  effectiveValueFor,
  clusterSettingKeys,
  type FieldValue,
} from "./settings-registry-utils";
import { SettingField } from "./settings-field";

type EffectiveMap = Partial<Record<SettingKey, FieldValue>>;
type ChangesMap = Partial<Record<SettingKey, FieldValue>>;

async function callFeaturesApi(
  body: Record<string, unknown>,
): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  const res = await fetch("/api/v3/admin/features", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data };
}

export function SystemSettingsManager() {
  const [activeTab, setActiveTab] = useState<string>(SETTINGS_TABS[0] ?? "");
  const [loading, setLoading] = useState(false);
  const [effective, setEffective] = useState<EffectiveMap>({});
  const [overridden, setOverridden] = useState<Set<SettingKey>>(new Set());
  const [changes, setChanges] = useState<ChangesMap>({});
  const [saving, setSaving] = useState(false);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [resetTarget, setResetTarget] = useState<SettingKey | null>(null);
  const [resettingKey, setResettingKey] = useState<SettingKey | null>(null);

  const [cleanupRunning, setCleanupRunning] = useState(false);
  const [cleanupResult, setCleanupResult] = useState<{
    success: boolean;
    stats?: Record<string, number>;
    error?: string;
  } | null>(null);
  const [tocOpen, setTocOpen] = useState(false);

  // "On this page" jump list: one entry per settings tab (switches the tab,
  // then scrolls the panel into view) plus the cleanup card below it.
  const tocItems: AdminTocItem[] = [
    ...SETTINGS_TABS.map((tab) => ({
      id: "settings-panel",
      label: tab,
      onSelect: () => setActiveTab(tab),
    })),
    { id: "settings-cleanup", label: "Database Cleanup" },
  ];

  const fetchEffective = useCallback(async () => {
    setLoading(true);
    try {
      const { ok, data } = await callFeaturesApi({
        section: "system_settings",
        action: "effective",
      });
      if (ok) {
        setEffective((data.effective as EffectiveMap) ?? {});
        setOverridden(new Set((data.overridden as SettingKey[]) ?? []));
      }
    } catch (error) {
      console.error("Error fetching effective settings:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount: setState only fires after the request resolves, not synchronously in this effect
    fetchEffective();
  }, [fetchEffective]);

  useUnsavedChangesWarning(Object.keys(changes).length > 0);

  const handleFieldChange = (key: SettingKey, value: FieldValue) => {
    setChanges((prev) => ({ ...prev, [key]: value }));
    setSaveError(null);
  };

  const fieldsInTab = FIELDS_BY_GROUP[activeTab] ?? [];
  const pendingInTab = fieldsInTab.filter(([key]) => key in changes);
  const hasTabChanges = pendingInTab.length > 0;

  const changeCountByTab = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const tab of SETTINGS_TABS) {
      counts[tab] = (FIELDS_BY_GROUP[tab] ?? []).filter(
        ([key]) => key in changes,
      ).length;
    }
    return counts;
  }, [changes]);

  const modalChanges: ChangeItem[] = pendingInTab.map(([key, def]) => ({
    field: key,
    label: def.label,
    oldValue: effectiveValueFor(key, effective),
    newValue: changes[key] as FieldValue,
  }));

  const destructiveFields = pendingInTab.filter(([key]) =>
    isDestructiveToggle(key, changes[key] as FieldValue),
  );

  const discardTabChanges = () => {
    setChanges((prev) => {
      const next = { ...prev };
      for (const [key] of fieldsInTab) delete next[key];
      return next;
    });
    setSaveError(null);
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    const failures: string[] = [];
    const succeeded: SettingKey[] = [];

    for (const [key] of pendingInTab) {
      const { ok, data } = await callFeaturesApi({
        section: "system_settings",
        action: "set",
        key,
        value: changes[key],
      });
      if (ok) {
        succeeded.push(key);
      } else {
        failures.push((data.error as string) || `Failed to save ${key}`);
      }
    }

    if (succeeded.length > 0) {
      setEffective((prev) => {
        const next = { ...prev };
        for (const key of succeeded) next[key] = changes[key];
        return next;
      });
      setOverridden((prev) => {
        const next = new Set(prev);
        for (const key of succeeded) next.add(key);
        return next;
      });
      setChanges((prev) => {
        const next = { ...prev };
        for (const key of succeeded) delete next[key];
        return next;
      });
    }

    setSaving(false);
    if (failures.length > 0) {
      setSaveError(failures.join(" "));
      // Thrown so SaveConfirmationModal's own try/catch keeps the dialog
      // open instead of playing the success animation. Error display is
      // handled by this component, not the modal.
      throw new Error("Some settings failed to save");
    }
  };

  const handleResetConfirm = async () => {
    const key = resetTarget;
    if (!key) return;
    setResettingKey(key);
    try {
      const { ok, data } = await callFeaturesApi({
        section: "system_settings",
        action: "reset",
        key,
      });
      if (ok) {
        setOverridden((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
        setEffective((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
        setChanges((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
        setResetTarget(null);
      } else {
        setSaveError((data.error as string) || `Failed to reset ${key}`);
      }
    } catch (error) {
      console.error("Error resetting setting:", error);
      setSaveError(`Failed to reset ${key}`);
    } finally {
      setResettingKey(null);
    }
  };

  const handleExport = () => {
    const dump = Object.fromEntries(
      [...overridden].map((key) => [key, effectiveValueFor(key, effective)]),
    );
    const blob = new Blob([JSON.stringify(dump, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "vulnradar-settings-export.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const importInputRef = useRef<HTMLInputElement>(null);
  const [importPreview, setImportPreview] = useState<ChangeItem[] | null>(null);
  const [importPending, setImportPending] = useState<ChangesMap>({});
  const [importUnknownKeys, setImportUnknownKeys] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file next time
    if (!file) return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      setSaveError("That file is not valid JSON.");
      return;
    }
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      setSaveError("Expected a flat JSON object of SETTING_KEY: value.");
      return;
    }

    const unknown: string[] = [];
    const pending: ChangesMap = {};
    const preview: ChangeItem[] = [];

    for (const [key, value] of Object.entries(
      parsed as Record<string, unknown>,
    )) {
      if (!(key in SETTINGS_REGISTRY)) {
        unknown.push(key);
        continue;
      }
      const settingKey = key as SettingKey;
      const current = effectiveValueFor(settingKey, effective);
      // Booleans/numbers/strings only, matching what the registry's own
      // types allow; anything else (an object, an array) can't be a valid
      // setting value so treat it the same as an unknown key.
      if (
        typeof value !== "string" &&
        typeof value !== "number" &&
        typeof value !== "boolean"
      ) {
        unknown.push(key);
        continue;
      }
      if (value === current) continue; // already matches, nothing to do
      pending[settingKey] = value;
      preview.push({
        field: settingKey,
        label: SETTINGS_REGISTRY[settingKey].label,
        oldValue: current,
        newValue: value,
      });
    }

    setImportUnknownKeys(unknown);
    setImportPending(pending);
    setSaveError(null);

    if (preview.length === 0) {
      setSaveError(
        unknown.length > 0
          ? `Nothing to import: every recognized key already matches, and ${unknown.length} key(s) were not recognized.`
          : "Nothing to import: every value in that file already matches the current settings.",
      );
      return;
    }
    setImportPreview(preview);
  };

  const handleConfirmImport = async () => {
    setImporting(true);
    const failures: string[] = [];
    for (const [key, value] of Object.entries(importPending) as [
      SettingKey,
      FieldValue,
    ][]) {
      const { ok, data } = await callFeaturesApi({
        section: "system_settings",
        action: "set",
        key,
        value,
      });
      if (ok) {
        setEffective((prev) => ({ ...prev, [key]: value }));
        setOverridden((prev) => new Set(prev).add(key));
      } else {
        failures.push((data.error as string) || `Failed to import ${key}`);
      }
    }
    setImporting(false);
    if (failures.length > 0) {
      setSaveError(failures.join(" "));
      throw new Error("Some settings failed to import");
    }
    setImportPreview(null);
    setImportPending({});
    if (importUnknownKeys.length > 0) {
      setSaveError(
        `Imported. Skipped ${importUnknownKeys.length} key(s) not recognized by this version: ${importUnknownKeys.join(", ")}.`,
      );
    }
  };

  const runCleanup = async () => {
    setCleanupRunning(true);
    setCleanupResult(null);
    try {
      const res = await fetch("/api/v3/admin/cleanup", { method: "POST" });
      const data = await res.json();
      setCleanupResult(data);
    } catch {
      setCleanupResult({ success: false, error: "Request failed" });
    } finally {
      setCleanupRunning(false);
    }
  };

  const resetDef = resetTarget ? SETTINGS_REGISTRY[resetTarget] : null;

  return (
    <div className="space-y-6">
      {saveError && (
        <div className="flex items-start gap-3 p-4 rounded-xl border border-destructive/30 bg-destructive/10">
          <div className="p-2 rounded-lg bg-destructive/20 shrink-0">
            <AlertTriangle
              className="h-4 w-4 text-destructive"
              aria-hidden="true"
            />
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium text-destructive">
              Some settings could not be saved
            </p>
            <p className="text-xs text-destructive/80 mt-0.5">{saveError}</p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0 shrink-0"
            onClick={() => setSaveError(null)}
            aria-label="Dismiss"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        </div>
      )}

      {/* Settings Card */}
      <Card
        id="settings-panel"
        className="border-border/50 bg-card/50 overflow-hidden"
      >
        <div className="px-4 sm:px-5 py-4 border-b border-border/50">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <Settings className="h-4 w-4 text-primary" aria-hidden="true" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-foreground">
                  System Settings
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {Object.keys(SETTINGS_REGISTRY).length} configurable values. A
                  database override wins over the shipped default.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 border-border/40"
                onClick={handleExport}
                disabled={overridden.size === 0}
                aria-label="Export customized settings as JSON"
              >
                <Download className="h-4 w-4" aria-hidden="true" />
                <span className="hidden sm:inline">Export</span>
              </Button>
              <input
                ref={importInputRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={handleImportFile}
              />
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 border-border/40"
                onClick={() => importInputRef.current?.click()}
                aria-label="Import settings from a JSON file"
              >
                <Upload className="h-4 w-4" aria-hidden="true" />
                <span className="hidden sm:inline">Import</span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 border-border/40"
                onClick={fetchEffective}
                disabled={loading}
                aria-label="Refresh system settings"
              >
                <RefreshCw
                  className={cn("h-4 w-4", loading && "animate-spin")}
                  aria-hidden="true"
                />
                <span className="hidden sm:inline">Refresh</span>
              </Button>
            </div>
          </div>
        </div>

        <CardContent className="p-3 sm:p-4">
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            {/* Below lg, the "Contents" drawer (AdminMobileTocTrigger below)
                already switches tabs, so this strip would just be a second,
                wrapping copy of the same nav competing for space above the
                fold. */}
            <TabsList className="hidden lg:flex h-auto flex-wrap justify-start gap-1 bg-muted/50 p-1">
              {SETTINGS_TABS.map((tab) => (
                <TabsTrigger
                  key={tab}
                  value={tab}
                  className="gap-1.5 text-xs sm:text-sm"
                >
                  {tab}
                  {changeCountByTab[tab] > 0 && (
                    <span className="inline-flex items-center justify-center h-4 min-w-4 px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-semibold">
                      {changeCountByTab[tab]}
                    </span>
                  )}
                </TabsTrigger>
              ))}
            </TabsList>

            {SETTINGS_TABS.map((tab) => (
              <TabsContent key={tab} value={tab} className="mt-4">
                {tabHasBuildTierFields(tab) && (
                  <div className="flex items-start gap-3 p-3 mb-3 rounded-lg border border-primary/20 bg-primary/5">
                    <Info
                      className="h-4 w-4 text-primary shrink-0 mt-0.5"
                      aria-hidden="true"
                    />
                    <p className="text-xs text-muted-foreground">
                      These settings are baked into the built pages. Saving here
                      updates the database immediately, but the change only
                      shows up after the next build and deploy.
                    </p>
                  </div>
                )}
                {loading ? (
                  <SettingsFieldsSkeleton />
                ) : (
                  <div className="rounded-lg border border-border/40 overflow-hidden">
                    {(() => {
                      const tabFields = FIELDS_BY_GROUP[tab] ?? [];
                      const defByKey = Object.fromEntries(tabFields);
                      const clusters = clusterSettingKeys(
                        tabFields.map(([key]) => key),
                      );
                      return clusters.map((cluster, ci) => (
                        <div
                          key={cluster.label ?? `_${ci}`}
                          className={cn(ci > 0 && "border-t border-border/40")}
                        >
                          {cluster.label && (
                            <p className="px-4 sm:px-5 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70 bg-muted/20">
                              {cluster.label}
                            </p>
                          )}
                          <div className="divide-y divide-border/40">
                            {cluster.keys.map((key) => (
                              <SettingField
                                key={key}
                                fieldKey={key}
                                def={defByKey[key]}
                                value={
                                  (changes[key] ??
                                    effectiveValueFor(
                                      key,
                                      effective,
                                    )) as FieldValue
                                }
                                isOverridden={overridden.has(key)}
                                isPending={key in changes}
                                isResetting={resettingKey === key}
                                onChange={handleFieldChange}
                                onResetRequest={setResetTarget}
                              />
                            ))}
                          </div>
                        </div>
                      ));
                    })()}
                  </div>
                )}
              </TabsContent>
            ))}
          </Tabs>
        </CardContent>
      </Card>

      {/* Database Cleanup */}
      <Card
        id="settings-cleanup"
        className="border-border/50 bg-card/50 overflow-hidden"
      >
        <div className="px-4 sm:px-5 py-4 border-b border-border/50">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-destructive/10">
              <Trash2 className="h-4 w-4 text-destructive" aria-hidden="true" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-foreground">
                Database Cleanup
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Remove expired tokens, old sessions, and stale data. Runs
                automatically every 5 minutes.
              </p>
            </div>
          </div>
        </div>
        <CardContent className="p-4 sm:p-5">
          <div className="flex flex-col sm:flex-row sm:items-center gap-4">
            <div className="flex-1 text-sm text-muted-foreground">
              Cleans up expired reset tokens, email codes, sessions, revoked API
              keys, old scan history (per plan retention), audit logs older than
              365 days, and other stale database rows.
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 border-border/40 shrink-0"
              onClick={runCleanup}
              disabled={cleanupRunning}
            >
              {cleanupRunning ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              )}
              {cleanupRunning ? "Running..." : "Run Cleanup Now"}
            </Button>
          </div>
          {cleanupResult && (
            <div
              className={cn(
                "mt-4 rounded-lg border p-3",
                cleanupResult.success
                  ? "border-[hsl(var(--success))]/20 bg-[hsl(var(--success))]/5"
                  : "border-destructive/20 bg-destructive/5",
              )}
              role="status"
            >
              {cleanupResult.success ? (
                <div>
                  <p className="text-sm font-medium text-[hsl(var(--success))] flex items-center gap-1.5">
                    <CheckCheck className="h-4 w-4" aria-hidden="true" />
                    Cleanup completed
                  </p>
                  {cleanupResult.stats &&
                    Object.keys(cleanupResult.stats).length > 0 && (
                      <div className="mt-2 grid grid-cols-2 sm:grid-cols-3 gap-2">
                        {Object.entries(cleanupResult.stats).map(
                          ([key, count]) =>
                            count > 0 ? (
                              <div
                                key={key}
                                className="text-xs text-muted-foreground"
                              >
                                <span className="font-medium text-foreground">
                                  {count}
                                </span>{" "}
                                {key.replace(/_/g, " ")}
                              </div>
                            ) : null,
                        )}
                      </div>
                    )}
                </div>
              ) : (
                <p className="text-sm text-destructive">
                  {cleanupResult.error || "Cleanup failed"}
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Floating save bar, scoped to the active tab's pending changes */}
      {hasTabChanges && (
        <div className="fixed bottom-0 left-0 right-0 z-50 p-4 pointer-events-none">
          <div className="max-w-lg mx-auto pointer-events-auto">
            <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-xl bg-card border border-border/50 shadow-lg backdrop-blur-xs">
              <div className="flex items-center gap-3">
                <div className="p-1.5 rounded-lg bg-primary/10">
                  <Save
                    className="h-3.5 w-3.5 text-primary"
                    aria-hidden="true"
                  />
                </div>
                <p className="text-sm font-medium text-foreground">
                  {pendingInTab.length} unsaved change
                  {pendingInTab.length !== 1 ? "s" : ""} in {activeTab}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={discardTabChanges}
                  disabled={saving}
                  className="h-8 gap-1.5"
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                  <span className="hidden sm:inline">Discard</span>
                </Button>
                <Button
                  size="sm"
                  className="h-8 gap-1.5"
                  onClick={() => setShowSaveModal(true)}
                  disabled={saving}
                >
                  {saving ? (
                    <Loader2
                      className="h-3.5 w-3.5 animate-spin"
                      aria-hidden="true"
                    />
                  ) : (
                    <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                  <span className="hidden sm:inline">Save Changes</span>
                  <span className="sm:hidden">Save</span>
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Save confirmation modal, scoped to the active tab */}
      <SaveConfirmationModal
        isOpen={showSaveModal}
        onClose={() => setShowSaveModal(false)}
        onConfirm={async () => {
          await handleSave();
          setShowSaveModal(false);
        }}
        title={`Save ${activeTab} Settings`}
        description={
          destructiveFields.length > 0
            ? destructiveFields.map(([, def]) => def.help).join(" ")
            : "Review and confirm changes to system configuration."
        }
        changes={modalChanges}
        loading={saving}
        confirmText="Save Settings"
        variant={destructiveFields.length > 0 ? "destructive" : "default"}
      />

      {/* Import confirmation, can span every tab at once (not scoped to
          activeTab the way a normal save is), since a settings export is a
          whole-site snapshot. */}
      <SaveConfirmationModal
        isOpen={importPreview !== null}
        onClose={() => {
          setImportPreview(null);
          setImportPending({});
        }}
        onConfirm={handleConfirmImport}
        title="Import Settings"
        description={
          importUnknownKeys.length > 0
            ? `${importUnknownKeys.length} key(s) in that file are not recognized by this version and will be skipped: ${importUnknownKeys.join(", ")}.`
            : "Review and confirm every change from the imported file."
        }
        changes={importPreview ?? []}
        loading={importing}
        confirmText="Import Settings"
        variant="destructive"
      />

      {/* Reset-to-default confirmation */}
      <ConfirmDialog
        open={resetTarget !== null}
        title="Reset to default"
        description={
          resetDef
            ? `Delete the stored override for "${resetDef.label}"? It falls back to "${formatFieldValue(resetDef.default)}" and automatically picks up any future default change.`
            : ""
        }
        confirmLabel="Reset"
        onConfirm={handleResetConfirm}
        onCancel={() => setResetTarget(null)}
      />

      {/* Mobile "on this page" nav: this page is long enough (many settings
          tabs plus the cleanup card below) to need a jump list. */}
      <AdminMobileTocTrigger
        isOpen={tocOpen}
        onToggle={() => setTocOpen((o) => !o)}
      />
      <AdminMobileToc
        title="System Settings"
        items={tocItems}
        isOpen={tocOpen}
        onClose={() => setTocOpen(false)}
      />
    </div>
  );
}
