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
} from "lucide-react";
import {
  SaveConfirmationModal,
  type ChangeItem,
} from "@/components/shared/save-confirmation-modal";
import { ListSearchInput } from "@/components/shared/list-filter-bar";
import { downloadBlob } from "@/lib/ui/download";
import { API, APP_SLUG } from "@/lib/config/client-constants";
import {
  SkeletonRegion,
  AdminPanelHeader,
  StatusPill,
  useUnsavedChangesWarning,
  AdminMobileToc,
  AdminMobileTocTrigger,
  SettingsFieldsSkeleton,
  type AdminTocItem,
} from "@/components/admin/shared";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { cn } from "@/lib/ui/utils";
import { pluralize } from "@/lib/ui/plural";
import {
  SETTINGS_REGISTRY,
  isSecretSetting,
  isWritableSetting,
  type SettingKey,
} from "@/lib/config/registry";
import {
  SETTINGS_TABS,
  FIELDS_BY_GROUP,
  formatFieldValue,
  isDestructiveToggle,
  effectiveValueFor,
  buildSettingBlocks,
  blockKeys,
  settingMatchesQuery,
  type FieldValue,
  type SettingBlock,
} from "./settings-registry-utils";
import {
  SettingField,
  type SettingFieldState,
  type SettingResetHandler,
} from "./settings-field";
import { SettingRateLimitRow, SettingsPlanMatrix } from "./settings-blocks";

type EffectiveMap = Partial<Record<SettingKey, FieldValue>>;
type ChangesMap = Partial<Record<SettingKey, FieldValue>>;

/** Each tab's layout, derived once: the registry does not change at runtime. */
const BLOCKS_BY_TAB: Record<string, SettingBlock[]> = Object.fromEntries(
  SETTINGS_TABS.map((tab) => [
    tab,
    buildSettingBlocks((FIELDS_BY_GROUP[tab] ?? []).map(([key]) => key)),
  ]),
);

const TOTAL_SETTINGS = Object.keys(SETTINGS_REGISTRY).length;

/**
 * Human labels for the cleanup run's per-table counts. The keys are camelCase
 * identifiers from CleanupStats (lib/database/cleanup.ts). Anything added to
 * CleanupStats later falls through to deCamel() below, which at least produces
 * "old webhook deliveries" rather than a raw identifier.
 */
const CLEANUP_STAT_LABELS: Record<string, string> = {
  expiredSessions: "expired sessions",
  oldApiUsage: "API usage rows",
  revokedApiKeys: "revoked API keys",
  oldDataRequests: "old data requests",
  oldScans: "scans past retention",
  oldRateLimits: "rate-limit counters",
  expiredTokens: "expired tokens",
  expiredInvites: "expired invites",
  expired2FACodes: "expired 2FA codes",
  expiredBillingCodes: "expired billing codes",
  expiredDeviceTrust: "expired device trusts",
  expiredNotifications: "expired notifications",
  expiredGiftedSubs: "expired gifted subs",
  oldAuditLogs: "audit log rows",
  oldAdminNotes: "old admin notes",
  oldStaffActivity: "staff activity rows",
  oldSubdomainCache: "subdomain cache rows",
  oldAiConversations: "old AI conversations",
  oldScanFindingFeedback: "finding feedback rows",
  oldUserNotifications: "user notifications",
  oldGithubReviewUsage: "GitHub review usage rows",
  oldBrowserSessions: "old browser sessions",
  oldKevCache: "KEV cache rows",
  oldErrorLogs: "error log entries",
  archivedAuditLogs: "audit rows archived",
  oldEmailLogs: "email log entries",
  oldWebhookDeliveries: "webhook delivery rows",
};

function deCamel(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .toLowerCase();
}

async function callFeaturesApi(
  body: Record<string, unknown>,
): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  const res = await fetch(`${API.ADMIN}/features`, {
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
  const [secretsSet, setSecretsSet] = useState<Set<SettingKey>>(new Set());
  const [changes, setChanges] = useState<ChangesMap>({});
  const [saving, setSaving] = useState(false);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [resetTarget, setResetTarget] = useState<SettingKey[] | null>(null);
  const [confirmCleanup, setConfirmCleanup] = useState(false);
  const [resettingKeys, setResettingKeys] = useState<Set<SettingKey>>(
    new Set(),
  );
  const [query, setQuery] = useState("");
  const [changedOnly, setChangedOnly] = useState(false);
  // A failed load must not render every field at its shipped default with no
  // "Customized" badges. That looks exactly like a clean install, so an admin
  // edits from a false baseline and can silently revert real configuration
  // across the whole product on the next save.
  const [loadError, setLoadError] = useState<string | null>(null);

  const [cleanupRunning, setCleanupRunning] = useState(false);
  const [cleanupResult, setCleanupResult] = useState<{
    success: boolean;
    stats?: Record<string, number>;
    error?: string;
  } | null>(null);
  const [tocOpen, setTocOpen] = useState(false);

  const filtering = query.trim() !== "" || changedOnly;

  // "On this page" jump list for phones, where the tab rail is hidden: one
  // entry per settings tab (switches the tab, then scrolls the panel into
  // view) plus the cleanup card below it.
  const tocItems: AdminTocItem[] = [
    ...SETTINGS_TABS.map((tab) => ({
      id: `settings-tab-${tab}`,
      targetId: "settings-panel",
      label: tab,
      active: !filtering && activeTab === tab,
      onSelect: () => {
        setQuery("");
        setChangedOnly(false);
        setActiveTab(tab);
      },
    })),
    { id: "settings-cleanup", label: "Database Cleanup" },
  ];

  const fetchEffective = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const { ok, data } = await callFeaturesApi({
        section: "system_settings",
        action: "effective",
      });
      if (!ok) {
        setLoadError(
          (data.error as string) || "Could not load the current settings.",
        );
        return;
      }
      setEffective((data.effective as EffectiveMap) ?? {});
      setOverridden(new Set((data.overridden as SettingKey[]) ?? []));
      setSecretsSet(new Set((data.secretsSet as SettingKey[]) ?? []));
    } catch (error) {
      console.error("Error fetching effective settings:", error);
      setLoadError("Could not load the current settings.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount: setState only fires after the request resolves, not synchronously in this effect
    fetchEffective();
  }, [fetchEffective]);

  const pendingKeys = Object.keys(changes) as SettingKey[];
  useUnsavedChangesWarning(pendingKeys.length > 0);

  const handleFieldChange = (key: SettingKey, value: FieldValue) => {
    setChanges((prev) => ({ ...prev, [key]: value }));
    setSaveError(null);
  };

  const stateOf = (key: SettingKey): SettingFieldState => ({
    value: (changes[key] ?? effectiveValueFor(key, effective)) as FieldValue,
    isOverridden: overridden.has(key),
    isPending: key in changes,
    isResetting: resettingKeys.has(key),
    secretIsSet: secretsSet.has(key),
  });

  const pendingCountByTab = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const tab of SETTINGS_TABS) {
      counts[tab] = (FIELDS_BY_GROUP[tab] ?? []).filter(
        ([key]) => key in changes,
      ).length;
    }
    return counts;
  }, [changes]);

  // The confirmation dialog shows before and after. For a credential that
  // would print the value the admin just typed, on screen, in a dialog built to
  // be read over someone's shoulder, so it says what happens instead.
  const secretLabel = (key: SettingKey) =>
    secretsSet.has(key) ? "(stored)" : "(not set)";

  const modalChanges: ChangeItem[] = pendingKeys.map((key) => ({
    field: key,
    label: SETTINGS_REGISTRY[key].label,
    oldValue: isSecretSetting(key)
      ? secretLabel(key)
      : effectiveValueFor(key, effective),
    newValue: isSecretSetting(key)
      ? changes[key] === ""
        ? "(cleared)"
        : "(new value)"
      : (changes[key] as FieldValue),
  }));

  const destructiveKeys = pendingKeys.filter((key) =>
    isDestructiveToggle(key, changes[key] as FieldValue),
  );

  const discardChanges = () => {
    setChanges({});
    setSaveError(null);
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    const failures: string[] = [];
    const succeeded: SettingKey[] = [];

    for (const key of pendingKeys) {
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
        for (const key of succeeded) {
          if (!isSecretSetting(key)) next[key] = changes[key];
        }
        return next;
      });
      setSecretsSet((prev) => {
        const next = new Set(prev);
        for (const key of succeeded) {
          if (!isSecretSetting(key)) continue;
          if (changes[key]) next.add(key);
          else next.delete(key);
        }
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

  const handleResetRequest: SettingResetHandler = (keys) => {
    if (keys.length > 0) setResetTarget(keys);
  };

  const handleResetConfirm = async () => {
    const keys = resetTarget;
    if (!keys) return;
    setResettingKeys(new Set(keys));
    const failures: string[] = [];
    const done: SettingKey[] = [];
    for (const key of keys) {
      try {
        const { ok, data } = await callFeaturesApi({
          section: "system_settings",
          action: "reset",
          key,
        });
        if (ok) done.push(key);
        else failures.push((data.error as string) || `Failed to reset ${key}`);
      } catch (error) {
        console.error("Error resetting setting:", error);
        failures.push(`Failed to reset ${key}`);
      }
    }
    const drop = <T,>(prev: Set<T>) => {
      const next = new Set(prev);
      for (const key of done) next.delete(key as T);
      return next;
    };
    setOverridden(drop);
    setSecretsSet(drop);
    setEffective((prev) => {
      const next = { ...prev };
      for (const key of done) delete next[key];
      return next;
    });
    setChanges((prev) => {
      const next = { ...prev };
      for (const key of done) delete next[key];
      return next;
    });
    setResettingKeys(new Set());
    setResetTarget(null);
    if (failures.length > 0) setSaveError(failures.join(" "));
  };

  // Credentials are left out: the browser never has their values, and an
  // export is a file that gets attached to tickets and committed to repos.
  // So are compiled values, which nothing reads and the API no longer saves.
  const handleExport = () => {
    const dump = Object.fromEntries(
      [...overridden]
        .filter((key) => !isSecretSetting(key) && isWritableSetting(key))
        .map((key) => [key, effectiveValueFor(key, effective)]),
    );
    const blob = new Blob([JSON.stringify(dump, null, 2)], {
      type: "application/json",
    });
    downloadBlob(blob, `${APP_SLUG}-settings-export.json`);
  };

  const importInputRef = useRef<HTMLInputElement>(null);
  const [importPreview, setImportPreview] = useState<ChangeItem[] | null>(null);
  const [importPending, setImportPending] = useState<ChangesMap>({});
  const [importSkippedKeys, setImportSkippedKeys] = useState<string[]>([]);
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

    const skipped: string[] = [];
    const pending: ChangesMap = {};
    const preview: ChangeItem[] = [];

    for (const [key, value] of Object.entries(
      parsed as Record<string, unknown>,
    )) {
      // Unknown keys, compiled keys the API refuses, and anything that is not
      // a plain scalar are all skipped and named in the confirmation.
      if (
        !(key in SETTINGS_REGISTRY) ||
        !isWritableSetting(key as SettingKey)
      ) {
        skipped.push(key);
        continue;
      }
      const settingKey = key as SettingKey;
      if (
        typeof value !== "string" &&
        typeof value !== "number" &&
        typeof value !== "boolean"
      ) {
        skipped.push(key);
        continue;
      }
      const secret = isSecretSetting(settingKey);
      const current = effectiveValueFor(settingKey, effective);
      if (!secret && value === current) continue; // already matches
      pending[settingKey] = value;
      preview.push({
        field: settingKey,
        label: SETTINGS_REGISTRY[settingKey].label,
        oldValue: secret ? secretLabel(settingKey) : current,
        newValue: secret ? (value === "" ? "(cleared)" : "(new value)") : value,
      });
    }

    setImportSkippedKeys(skipped);
    setImportPending(pending);
    setSaveError(null);

    if (preview.length === 0) {
      setSaveError(
        skipped.length > 0
          ? `Nothing to import: every value that can be saved already matches, and ${pluralize(skipped.length, "key")} could not be imported.`
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
        if (isSecretSetting(key)) {
          setSecretsSet((prev) => {
            const next = new Set(prev);
            if (value) next.add(key);
            else next.delete(key);
            return next;
          });
        } else {
          setEffective((prev) => ({ ...prev, [key]: value }));
        }
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
    if (importSkippedKeys.length > 0) {
      setSaveError(
        `Imported. Skipped ${pluralize(importSkippedKeys.length, "key")} that cannot be saved here: ${importSkippedKeys.join(", ")}.`,
      );
    }
  };

  // Retention cleanup is irreversible and database-wide, so it is the action
  // that gets the confirmation.
  const runCleanup = async () => {
    setConfirmCleanup(false);
    setCleanupRunning(true);
    setCleanupResult(null);
    try {
      const res = await fetch(`${API.ADMIN}/cleanup`, { method: "POST" });
      const data = await res.json();
      setCleanupResult(data);
    } catch {
      setCleanupResult({ success: false, error: "Request failed" });
    } finally {
      setCleanupRunning(false);
    }
  };

  const keyMatches = (key: SettingKey) =>
    (!query.trim() || settingMatchesQuery(key, query)) &&
    (!changedOnly || overridden.has(key) || key in changes);

  const filterBlocks = (blocks: SettingBlock[]): SettingBlock[] =>
    blocks.flatMap((block): SettingBlock[] => {
      if (block.kind === "plans") {
        const metrics = block.metrics.filter((m) =>
          Object.values(m.keys).some(keyMatches),
        );
        return metrics.length > 0 ? [{ ...block, metrics }] : [];
      }
      return blockKeys(block).some(keyMatches) ? [block] : [];
    });

  const renderBlocks = (blocks: SettingBlock[]) => (
    <div className="divide-y divide-border/40 overflow-hidden rounded-lg border border-border/40">
      {blocks.map((block) => {
        if (block.kind === "plans") {
          return (
            <SettingsPlanMatrix
              key={`plans-${block.metrics[0]?.metric}`}
              metrics={block.metrics}
              stateOf={stateOf}
              onChange={handleFieldChange}
              onResetRequest={handleResetRequest}
            />
          );
        }
        if (block.kind === "rate") {
          return (
            <SettingRateLimitRow
              key={block.limit}
              limitKey={block.limit}
              windowKey={block.window}
              stateOf={stateOf}
              onChange={handleFieldChange}
              onResetRequest={handleResetRequest}
            />
          );
        }
        return (
          <SettingField
            key={block.key}
            fieldKey={block.key}
            state={stateOf(block.key)}
            onChange={handleFieldChange}
            onResetRequest={handleResetRequest}
          />
        );
      })}
    </div>
  );

  const tabSummary = (tab: string) => {
    const keys = (FIELDS_BY_GROUP[tab] ?? []).map(([key]) => key);
    const changed = keys.filter((key) => overridden.has(key)).length;
    const compiled = keys.filter((key) => !isWritableSetting(key)).length;
    return { total: keys.length, changed, compiled };
  };

  const filteredTabs = filtering
    ? SETTINGS_TABS.map((tab) => ({
        tab,
        blocks: filterBlocks(BLOCKS_BY_TAB[tab] ?? []),
      })).filter((entry) => entry.blocks.length > 0)
    : [];
  const filteredCount = filteredTabs.reduce(
    (sum, entry) =>
      sum + entry.blocks.flatMap(blockKeys).filter(keyMatches).length,
    0,
  );

  const resetDefs = (resetTarget ?? []).map((key) => SETTINGS_REGISTRY[key]);

  return (
    <div className="space-y-6">
      {saveError && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-4"
        >
          <div className="shrink-0 rounded-md bg-destructive/20 p-2">
            <AlertTriangle
              className="h-4 w-4 text-destructive"
              aria-hidden="true"
            />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-destructive">
              Some settings could not be saved
            </p>
            <p className="mt-0.5 text-xs leading-relaxed text-destructive/80 wrap-break-word">
              {saveError}
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-11 w-11 shrink-0 p-0 sm:h-7 sm:w-7"
            onClick={() => setSaveError(null)}
            aria-label="Dismiss"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        </div>
      )}

      <Card
        id="settings-panel"
        className="overflow-hidden border-border/50 bg-card/50"
      >
        <AdminPanelHeader
          icon={Settings}
          title="System Settings"
          subtitle={
            <>
              <span className="tabular-nums">{overridden.size}</span> of{" "}
              <span className="tabular-nums">{TOTAL_SETTINGS}</span> settings
              changed from their defaults on this instance.
            </>
          }
          status={
            overridden.size > 0 ? (
              <StatusPill tone="info">Customized</StatusPill>
            ) : null
          }
          actions={
            <>
              <Button
                variant="outline"
                size="sm"
                className="h-9 gap-2 border-border/40 px-3"
                onClick={handleExport}
                disabled={overridden.size === 0}
                aria-label="Export changed settings as JSON"
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
                className="h-9 gap-2 border-border/40 px-3"
                onClick={() => importInputRef.current?.click()}
                aria-label="Import settings from a JSON file"
              >
                <Upload className="h-4 w-4" aria-hidden="true" />
                <span className="hidden sm:inline">Import</span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-9 gap-2 border-border/40 px-3"
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
            </>
          }
        >
          {!loadError && (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <ListSearchInput
                value={query}
                onChange={setQuery}
                placeholder={`Search ${TOTAL_SETTINGS} settings`}
                label="Search settings"
              />
              <Button
                variant="outline"
                size="sm"
                aria-pressed={changedOnly}
                onClick={() => setChangedOnly((v) => !v)}
                className={cn(
                  "h-10 shrink-0 gap-2 border-border/40 px-3",
                  changedOnly &&
                    "border-primary/30 bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary",
                )}
              >
                Changed only
              </Button>
            </div>
          )}
        </AdminPanelHeader>

        <CardContent className="p-3 sm:p-4">
          {loadError ? (
            <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
              <div className="rounded-lg bg-destructive/10 p-2.5">
                <AlertTriangle
                  className="h-5 w-5 text-destructive"
                  aria-hidden="true"
                />
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">
                  Couldn&apos;t load system settings
                </p>
                <p className="mt-1 max-w-md text-xs leading-relaxed text-muted-foreground">
                  {loadError} The editor is hidden rather than shown filled with
                  shipped defaults, because saving from that state would wipe
                  your real overrides.
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 border-border/40"
                onClick={fetchEffective}
                disabled={loading}
              >
                <RefreshCw
                  className={cn("h-4 w-4", loading && "animate-spin")}
                  aria-hidden="true"
                />
                Try again
              </Button>
            </div>
          ) : loading ? (
            <SkeletonRegion label="Loading system settings">
              <SettingsFieldsSkeleton />
            </SkeletonRegion>
          ) : filtering ? (
            <div aria-live="polite">
              <p className="mb-3 px-1 text-xs text-muted-foreground">
                {filteredCount === 0
                  ? "No settings match."
                  : `${pluralize(filteredCount, "setting")} across ${pluralize(filteredTabs.length, "tab")}.`}
              </p>
              {filteredCount === 0 ? (
                <div className="rounded-lg border border-dashed border-border/60 px-4 py-10 text-center">
                  <p className="text-sm text-foreground">
                    {changedOnly && !query.trim()
                      ? "Nothing has been changed from its default yet."
                      : "Nothing matches that search."}
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-3 h-8 border-border/40"
                    onClick={() => {
                      setQuery("");
                      setChangedOnly(false);
                    }}
                  >
                    Show all settings
                  </Button>
                </div>
              ) : (
                <div className="space-y-6">
                  {filteredTabs.map(({ tab, blocks }) => (
                    <section key={tab} aria-label={tab}>
                      <h3 className="mb-2 px-1 text-sm font-semibold text-foreground">
                        {tab}
                      </h3>
                      {renderBlocks(blocks)}
                    </section>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <Tabs
              value={activeTab}
              onValueChange={setActiveTab}
              orientation="vertical"
              className="lg:grid lg:grid-cols-[12rem_minmax(0,1fr)] lg:gap-5"
            >
              {/* A rail rather than a strip: thirteen tabs wrapped onto two
                  lines above the fields and pushed the first setting below
                  the fold. Below lg the "Contents" drawer switches tabs. */}
              <TabsList className="hidden h-auto flex-col items-stretch justify-start gap-0.5 self-start bg-transparent p-0 lg:sticky lg:top-4 lg:flex">
                {SETTINGS_TABS.map((tab) => (
                  <TabsTrigger
                    key={tab}
                    value={tab}
                    className="justify-between gap-2 px-3 py-2 text-left text-sm font-normal text-muted-foreground hover:bg-muted/50 hover:text-foreground data-[state=active]:bg-muted data-[state=active]:font-medium"
                  >
                    <span className="truncate">{tab}</span>
                    {pendingCountByTab[tab] > 0 ? (
                      <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground tabular-nums">
                        <span className="sr-only">unsaved changes: </span>
                        {pendingCountByTab[tab]}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground/70 tabular-nums">
                        {tabSummary(tab).total}
                      </span>
                    )}
                  </TabsTrigger>
                ))}
              </TabsList>

              {SETTINGS_TABS.map((tab) => {
                const summary = tabSummary(tab);
                return (
                  <TabsContent key={tab} value={tab} className="mt-0">
                    <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-1">
                      <h3 className="text-base font-semibold text-foreground">
                        {tab}
                      </h3>
                      <p className="text-xs text-muted-foreground tabular-nums">
                        {pluralize(summary.total, "setting")}
                        {summary.changed > 0 && `, ${summary.changed} changed`}
                      </p>
                    </div>
                    {summary.compiled === summary.total && (
                      <p className="mb-3 px-1 text-xs leading-relaxed text-muted-foreground">
                        Everything here is compiled into the app, so it is shown
                        for reference. Each row names the constant to edit.
                      </p>
                    )}
                    {renderBlocks(BLOCKS_BY_TAB[tab] ?? [])}
                  </TabsContent>
                );
              })}
            </Tabs>
          )}
        </CardContent>
      </Card>

      <Card
        id="settings-cleanup"
        className="overflow-hidden border-border/50 bg-card/50"
      >
        <AdminPanelHeader
          icon={Trash2}
          tone="crit"
          title="Database Cleanup"
          subtitle="Removes expired tokens, old sessions, and stale data. Runs automatically every 5 minutes."
        />
        <CardContent className="p-4 sm:p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <p className="flex-1 text-sm text-muted-foreground">
              Cleans up expired reset tokens, email codes, sessions, revoked API
              keys, old scan history (per plan retention), audit logs older than
              365 days, and other stale database rows.
            </p>
            {/* Solid destructive: this deletes scan history and audit rows
                across every account on the instance and cannot be undone. */}
            <Button
              variant="destructive"
              size="sm"
              className="h-9 shrink-0 gap-2 px-3"
              onClick={() => setConfirmCleanup(true)}
              disabled={cleanupRunning}
            >
              {cleanupRunning ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              )}
              {cleanupRunning ? "Running..." : "Run cleanup now"}
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
                  <p className="flex items-center gap-1.5 text-sm font-medium text-[hsl(var(--success))]">
                    <CheckCheck className="h-4 w-4" aria-hidden="true" />
                    Cleanup completed
                  </p>
                  {cleanupResult.stats &&
                    Object.keys(cleanupResult.stats).length > 0 && (
                      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                        {Object.entries(cleanupResult.stats).map(
                          ([key, count]) =>
                            count > 0 ? (
                              <div
                                key={key}
                                className="text-xs text-muted-foreground"
                              >
                                <span className="font-medium text-foreground tabular-nums">
                                  {count.toLocaleString()}
                                </span>{" "}
                                {CLEANUP_STAT_LABELS[key] ?? deCamel(key)}
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

      {/* Floating save bar for every pending change, whichever tab it is on.
          It used to save only the open tab, so an edit made on Billing and
          then left for Rate Limits sat unsaved behind a bar that did not
          mention it. bottom offsets by --vr-cookie-h so the cookie notice does
          not cover it, same as /profile's save bar. */}
      {pendingKeys.length > 0 && (
        <div className="pointer-events-none fixed bottom-(--vr-cookie-h,0px) left-0 right-0 z-50 p-4">
          <div className="pointer-events-auto mx-auto max-w-lg">
            <div className="flex items-center justify-between gap-4 rounded-xl border border-border/50 bg-card px-4 py-3 shadow-lg">
              <div className="flex min-w-0 items-center gap-3">
                <div className="rounded-lg bg-primary/10 p-1.5">
                  <Save
                    className="h-3.5 w-3.5 text-primary"
                    aria-hidden="true"
                  />
                </div>
                <p className="truncate text-sm font-medium text-foreground">
                  {pluralize(pendingKeys.length, "unsaved change")}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={discardChanges}
                  disabled={saving}
                  aria-label="Discard changes"
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
                  Save
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      <SaveConfirmationModal
        isOpen={showSaveModal}
        onClose={() => setShowSaveModal(false)}
        onConfirm={async () => {
          await handleSave();
          setShowSaveModal(false);
        }}
        title="Save settings"
        description={
          destructiveKeys.length > 0
            ? destructiveKeys
                .map((key) => SETTINGS_REGISTRY[key].help)
                .join(" ")
            : "Review the changes before they apply. Runtime settings take effect within about 30 seconds."
        }
        changes={modalChanges}
        loading={saving}
        confirmText="Save settings"
        variant={destructiveKeys.length > 0 ? "destructive" : "default"}
      />

      {/* Import can span every tab at once, since a settings export is a
          whole-site snapshot. */}
      <SaveConfirmationModal
        isOpen={importPreview !== null}
        onClose={() => {
          setImportPreview(null);
          setImportPending({});
        }}
        onConfirm={handleConfirmImport}
        title="Import settings"
        description={
          importSkippedKeys.length > 0
            ? `${pluralize(importSkippedKeys.length, "key")} in that file cannot be saved here (unknown to this version, or compiled into the app) and will be skipped: ${importSkippedKeys.join(", ")}.`
            : "Review and confirm every change from the imported file."
        }
        changes={importPreview ?? []}
        loading={importing}
        confirmText="Import settings"
        variant="destructive"
      />

      <ConfirmDialog
        open={confirmCleanup}
        title="Run retention cleanup now?"
        description="This permanently deletes scan history and audit-log rows that are past their retention window, across every account on this instance, not just yours. It cannot be undone. Cleanup also runs on its own schedule, so this is only needed to force it early."
        confirmLabel="Delete expired rows"
        danger
        onConfirm={runCleanup}
        onCancel={() => setConfirmCleanup(false)}
      />

      <ConfirmDialog
        open={resetTarget !== null}
        title="Reset to default"
        description={
          resetDefs.length === 1
            ? `Delete the stored value for "${resetDefs[0].label}"? It falls back to "${formatFieldValue(resetDefs[0].default)}" and picks up any future change to that default.`
            : resetDefs.length > 1
              ? `Delete the stored values for ${resetDefs.map((d) => `"${d.label}"`).join(" and ")}? Each falls back to its shipped default and picks up any future change to it.`
              : ""
        }
        confirmLabel="Reset"
        onConfirm={handleResetConfirm}
        onCancel={() => setResetTarget(null)}
      />

      <AdminMobileTocTrigger
        isOpen={tocOpen}
        onToggle={() => setTocOpen((o) => !o)}
        raised={pendingKeys.length > 0}
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
