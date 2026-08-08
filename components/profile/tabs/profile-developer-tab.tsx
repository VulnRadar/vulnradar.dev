"use client";

import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/ui/utils";
import {
  Key,
  Webhook,
  CalendarClock,
  Loader2,
  type LucideIcon,
} from "lucide-react";
import { API } from "@/lib/config/constants";
import { useQueryParam } from "@/lib/ui/url-state";
import { useAuth } from "@/components/providers/auth-provider";
import { getPlanById } from "@/lib/billing/catalog";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type {
  ProfileTabProps,
  ApiKey,
  WebhookItem,
  ScheduleItem,
} from "../types";
import type { ConfirmAction, DeveloperSection } from "./developer/types";
import { ApiKeysSection } from "./developer/api-keys-section";
import { WebhooksSection } from "./developer/webhooks-section";
import { SchedulesSection } from "./developer/schedules-section";
import { GithubSection } from "./developer/github-section";

// The real cap is per-plan (free/core/pro/elite each have their own API key
// limit, admin-configurable from Settings) and enforced server-side in
// app/api/v3/keys/route.ts via lib/billing/plan-limits.ts. This reads the
// same shipped defaults from the plan catalog so the client-side hint and
// disabled state track the right number per plan instead of one flat
// guess -- it can still drift from an admin-customized limit (the catalog
// here is static, the server resolves live), in which case the server's
// own rejection message names the real number, same accepted gap as other
// client-side plan hints in this app.
const UNLIMITED_API_KEYS = -1;

// lucide-react dropped brand/logo icons (Github, Twitter, etc.) from its
// icon set; every other brand mark in this app (Discord, Slack, and the
// GitHub mark used inside GithubSection itself) already uses an inline SVG
// for the same reason. This is the same mark, sized for the sub-tab strip.
function GithubTabIcon({
  className,
}: {
  className?: string;
  "aria-hidden"?: boolean | "true" | "false";
}) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.57.1.78-.25.78-.55 0-.27-.01-1.17-.02-2.12-3.2.7-3.88-1.36-3.88-1.36-.52-1.33-1.28-1.69-1.28-1.69-1.04-.71.08-.69.08-.69 1.15.08 1.76 1.18 1.76 1.18 1.03 1.76 2.7 1.25 3.36.96.1-.75.4-1.25.73-1.54-2.56-.29-5.25-1.28-5.25-5.7 0-1.26.45-2.29 1.18-3.09-.12-.29-.51-1.46.11-3.05 0 0 .96-.31 3.15 1.18a10.9 10.9 0 0 1 2.87-.39c.97.01 1.95.13 2.87.39 2.19-1.49 3.15-1.18 3.15-1.18.62 1.59.23 2.76.11 3.05.73.8 1.18 1.83 1.18 3.09 0 4.43-2.7 5.4-5.27 5.69.41.36.78 1.06.78 2.14 0 1.55-.01 2.79-.01 3.17 0 .3.2.66.79.55A10.52 10.52 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5z" />
    </svg>
  );
}

// The Developer tab used to be one long scroll of API keys, webhooks, and
// scheduled scans. It's now four sub-tabs so each is independently
// scannable. This is a client-side sub-tab (like the top-level profile
// tabs), not separate routes, because /profile has no per-tab routing to
// plug into: the whole page is one client component keyed off a `tab`
// query param.
const DEVELOPER_SECTIONS: Array<{
  id: DeveloperSection;
  label: string;
  icon: LucideIcon | typeof GithubTabIcon;
}> = [
  { id: "api-keys", label: "API Keys", icon: Key },
  { id: "webhooks", label: "Webhooks", icon: Webhook },
  { id: "schedules", label: "Scheduled Scans", icon: CalendarClock },
  { id: "github", label: "GitHub", icon: GithubTabIcon },
];

function getConfirmCopy(action: ConfirmAction) {
  switch (action.kind) {
    case "rotate-key":
      return {
        title: `Rotate "${action.label}"?`,
        description:
          "The current secret stops working the moment you confirm. You'll get a new key to copy, so update it anywhere the old one is used.",
        confirmLabel: "Rotate key",
        destructive: false,
      };
    case "revoke-key":
      return {
        title: `Revoke "${action.label}"?`,
        description:
          "This key stops authenticating immediately and there is no replacement. Anything still calling the API with it will start failing.",
        confirmLabel: "Revoke key",
        destructive: true,
      };
    case "delete-webhook":
      return {
        title: `Delete the "${action.label}" webhook?`,
        description:
          "Finished scans stop posting here right away. You can add the same URL again later if you change your mind.",
        confirmLabel: "Delete webhook",
        destructive: true,
      };
    case "delete-schedule":
      return {
        title: "Remove this recurring scan?",
        description: `${action.label} will no longer be re-scanned automatically. You can schedule it again any time.`,
        confirmLabel: "Remove schedule",
        destructive: true,
      };
  }
}

// The schedules API returns `next_run_at` / `last_run_at` (see
// app/api/v3/schedules/route.ts and its tests), but the shared ScheduleItem
// type in components/profile/types.ts declares `next_run` / `last_run`.
// Read both spellings so "when does this run" isn't silently blank because
// of a mismatch in a type this component doesn't own.
function scheduleTimestamp(
  sch: ScheduleItem,
  which: "next_run" | "last_run",
): string | null {
  const record = sch as unknown as Record<string, string | null | undefined>;
  return record[which] ?? record[`${which}_at`] ?? null;
}

function isDeveloperSection(value: string): value is DeveloperSection {
  return DEVELOPER_SECTIONS.some((s) => s.id === value);
}

export function ProfileDeveloperTab({
  setError,
  setSuccess,
  loading,
  preloadedApiKeys,
  preloadedWebhooks,
  preloadedSchedules,
  setApiKeys: parentSetApiKeys,
  setWebhooks: parentSetWebhooks,
  setSchedules: parentSetSchedules,
}: ProfileTabProps) {
  const { me } = useAuth();
  const apiKeyLimit = getPlanById(me?.plan ?? "free")?.limits.apiKeys ?? 1;

  // Use preloaded data from parent, with local state as fallback
  const [localApiKeys, setLocalApiKeys] = useState<ApiKey[]>([]);
  const [localWebhooks, setLocalWebhooks] = useState<WebhookItem[]>([]);
  const [localSchedules, setLocalSchedules] = useState<ScheduleItem[]>([]);

  // Use preloaded data if available, otherwise use local state
  const apiKeys = preloadedApiKeys ?? localApiKeys;
  const webhooks = preloadedWebhooks ?? localWebhooks;
  const schedules = preloadedSchedules ?? localSchedules;

  // Use parent setters if available, otherwise use local setters
  const setApiKeys = parentSetApiKeys ?? setLocalApiKeys;
  const setWebhooks = parentSetWebhooks ?? setLocalWebhooks;
  const setSchedules = parentSetSchedules ?? setLocalSchedules;

  // Which sub-tab is showing. Kept in the URL, same pattern as the
  // top-level profile `tab` param, so a link to a specific sub-section
  // (e.g. straight to Webhooks) can be shared or bookmarked.
  const [devSectionRaw, setDevSectionRaw] = useQueryParam<string>(
    "dtab",
    "api-keys",
  );
  const activeSection: DeveloperSection = isDeveloperSection(devSectionRaw)
    ? devSectionRaw
    : "api-keys";

  const [newKeyName, setNewKeyName] = useState("");
  const [generatingKey, setGeneratingKey] = useState(false);
  const [newlyCreatedKey, setNewlyCreatedKey] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [copiedKey, setCopiedKey] = useState(false);
  const [keyActionPending, setKeyActionPending] = useState<{
    id: number;
    kind: "rotate" | "revoke";
  } | null>(null);
  const newKeyPanelRef = useRef<HTMLDivElement>(null);

  // Confirmation gate for rotate/revoke/delete actions across every
  // sub-tab.
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(
    null,
  );
  const [confirmBusy, setConfirmBusy] = useState(false);
  const confirmCopy = confirmAction ? getConfirmCopy(confirmAction) : null;

  // Webhooks state
  const [webhookUrl, setWebhookUrl] = useState("");
  const [webhookName, setWebhookName] = useState("");
  const [addingWebhook, setAddingWebhook] = useState(false);
  const [testingWebhookId, setTestingWebhookId] = useState<number | null>(null);

  // Schedules state
  const [scheduleUrl, setScheduleUrl] = useState("");
  const [scheduleFreq, setScheduleFreq] = useState("weekly");
  const [addingSchedule, setAddingSchedule] = useState(false);

  // Filter with null safety - ensure k exists and has expected properties
  const activeKeys = apiKeys.filter(
    (k) => k && typeof k === "object" && !k.revoked_at,
  );
  const atKeyLimit =
    apiKeyLimit !== UNLIMITED_API_KEYS && activeKeys.length >= apiKeyLimit;

  // Pull focus to a freshly issued key: it is shown once, so it must not be
  // possible to scroll past it without noticing.
  useEffect(() => {
    if (newlyCreatedKey) newKeyPanelRef.current?.focus();
  }, [newlyCreatedKey]);

  // API Key handlers
  async function handleGenerateKey() {
    if (atKeyLimit) {
      setError(
        `Your plan allows up to ${apiKeyLimit} active keys. Rotate one, or revoke it first.`,
      );
      return;
    }
    setGeneratingKey(true);
    setError(null);
    try {
      const body = { name: newKeyName || "Default" };

      const res = await fetch(API.KEYS, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to generate key.");
        return;
      }
      // API returns { key: { id, key_prefix, name, daily_limit, created_at, raw_key } }
      const keyRecord = data.key;

      setNewlyCreatedKey(keyRecord.raw_key);
      setApiKeys((prev) => [keyRecord, ...prev]);
      setNewKeyName("");
      setSuccess("API key generated successfully!");
    } catch {
      setError("Failed to generate key.");
    } finally {
      setGeneratingKey(false);
    }
  }

  async function handleRotateKey(keyId: number) {
    setKeyActionPending({ id: keyId, kind: "rotate" });
    setError(null);
    try {
      const rotateUrl = `${API.KEYS}/${keyId}/rotate`;
      const res = await fetch(rotateUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to rotate key.");
        return;
      }
      const newKey = data.key;
      setNewlyCreatedKey(newKey.raw_key);
      // Put the replacement where the old key was (front of the list), same
      // as a freshly generated key, so rotating doesn't reshuffle the list
      // out from under whoever is scanning it for a name.
      setApiKeys((prev) => [newKey, ...prev.filter((k) => k.id !== keyId)]);
      setSuccess(
        "Key rotated. The old key stopped working, copy the new one now.",
      );
    } catch {
      setError("Failed to rotate key.");
    } finally {
      setKeyActionPending(null);
    }
  }

  async function handleRevokeKey(keyId: number, keyName: string) {
    setKeyActionPending({ id: keyId, kind: "revoke" });
    setError(null);
    try {
      const res = await fetch(`${API.KEYS}/${keyId}/revoke`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to revoke key.");
        return;
      }
      setApiKeys((prev) => prev.filter((k) => k.id !== keyId));
      setSuccess(
        `"${keyName}" revoked. It stopped authenticating immediately.`,
      );
    } catch {
      setError("Failed to revoke key.");
    } finally {
      setKeyActionPending(null);
    }
  }

  async function handleDeleteWebhook(id: number, name: string) {
    setError(null);
    try {
      const res = await fetch(API.WEBHOOKS, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}) as { error?: string });
        setError(data.error || "Failed to delete webhook.");
        return;
      }
      setWebhooks((prev) => prev.filter((w) => w.id !== id));
      setSuccess(`"${name}" deleted.`);
    } catch {
      setError("Failed to delete webhook.");
    }
  }

  async function handleDeleteSchedule(id: number) {
    setError(null);
    try {
      const res = await fetch(API.SCHEDULES, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}) as { error?: string });
        setError(data.error || "Failed to remove the schedule.");
        return;
      }
      setSchedules((prev) => prev.filter((s) => s.id !== id));
      setSuccess("Scheduled scan removed.");
    } catch {
      setError("Failed to remove the schedule.");
    }
  }

  async function handleConfirmDestructive() {
    if (!confirmAction) return;
    setConfirmBusy(true);
    try {
      switch (confirmAction.kind) {
        case "rotate-key":
          await handleRotateKey(confirmAction.id);
          break;
        case "revoke-key":
          await handleRevokeKey(confirmAction.id, confirmAction.label);
          break;
        case "delete-webhook":
          await handleDeleteWebhook(confirmAction.id, confirmAction.label);
          break;
        case "delete-schedule":
          await handleDeleteSchedule(confirmAction.id);
          break;
      }
    } finally {
      setConfirmBusy(false);
      setConfirmAction(null);
    }
  }

  async function handleCopyKey() {
    if (!newlyCreatedKey) return;
    try {
      await navigator.clipboard.writeText(newlyCreatedKey);
      setCopiedKey(true);
      setTimeout(() => setCopiedKey(false), 2000);
    } catch {
      setError(
        "Could not copy automatically. Select the key text and copy it manually.",
      );
    }
  }

  async function handleAddWebhook() {
    setAddingWebhook(true);
    try {
      const res = await fetch(API.WEBHOOKS, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: webhookUrl,
          name: webhookName || "Default",
          type: "auto",
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setWebhooks((prev) => [data, ...prev]);
        setWebhookUrl("");
        setWebhookName("");
        setSuccess(`Webhook added (detected as ${data.type}).`);
      } else {
        setError(data.error || "Failed to add webhook.");
      }
    } catch {
      setError("Failed to add webhook.");
    }
    setAddingWebhook(false);
  }

  async function handleTestWebhook(id: number) {
    setTestingWebhookId(id);
    try {
      const res = await fetch(API.WEBHOOKS, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const data = await res.json();
      if (res.ok) {
        setSuccess("Test webhook sent successfully!");
      } else {
        setError(data.error || "Failed to test webhook");
      }
    } catch {
      setError("Failed to test webhook");
    }
    setTestingWebhookId(null);
  }

  async function handleAddSchedule() {
    setAddingSchedule(true);
    try {
      const res = await fetch(API.SCHEDULES, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: scheduleUrl,
          frequency: scheduleFreq,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setSchedules((prev) => [data, ...prev]);
        setScheduleUrl("");
        setSuccess("Schedule created successfully.");
      } else {
        setError(data.error || "Failed to create schedule.");
      }
    } catch {
      setError("Failed to create schedule.");
    }
    setAddingSchedule(false);
  }

  function formatDate(dateStr: string | null) {
    if (!dateStr) return "Never";
    return new Date(dateStr).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const sectionCount = (id: DeveloperSection) => {
    if (id === "api-keys") return activeKeys.length;
    if (id === "webhooks") return webhooks.length;
    if (id === "schedules") return schedules.length;
    // GitHub's connection status isn't part of this shell's preloaded data
    // (see GithubSection's own comment), so it has no badge count.
    return 0;
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Developer sub-tabs: API Keys / Webhooks / Scheduled Scans / GitHub,
          each independently scannable instead of one long scroll. */}
      <div className="flex gap-0.5 border-b border-border/80 overflow-x-auto scrollbar-hide -mx-1 px-1">
        {DEVELOPER_SECTIONS.map((section) => {
          const count = sectionCount(section.id);
          const isActive = activeSection === section.id;
          return (
            <button
              key={section.id}
              type="button"
              onClick={() => setDevSectionRaw(section.id)}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "flex items-center gap-2 px-3.5 py-2.5 text-sm font-medium transition-all whitespace-nowrap border-b-2 -mb-px",
                isActive
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              <section.icon className="h-4 w-4" aria-hidden="true" />
              {section.label}
              {count > 0 && (
                <span
                  className={cn(
                    "inline-flex items-center justify-center min-w-[1.25rem] h-5 rounded-full px-1 text-[11px] font-medium tabular-nums",
                    isActive
                      ? "bg-primary/10 text-primary"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {activeSection === "api-keys" && (
        <ApiKeysSection
          apiKeys={apiKeys}
          maxActiveKeys={apiKeyLimit}
          newKeyName={newKeyName}
          onNewKeyNameChange={setNewKeyName}
          generatingKey={generatingKey}
          onGenerateKey={handleGenerateKey}
          newlyCreatedKey={newlyCreatedKey}
          showKey={showKey}
          onToggleShowKey={() => setShowKey((v) => !v)}
          copiedKey={copiedKey}
          onCopyKey={handleCopyKey}
          onDismissNewKey={() => {
            setNewlyCreatedKey(null);
            setShowKey(false);
            setCopiedKey(false);
          }}
          newKeyPanelRef={newKeyPanelRef}
          keyActionPending={keyActionPending}
          onRequestConfirm={setConfirmAction}
          formatDate={formatDate}
        />
      )}

      {activeSection === "webhooks" && (
        <WebhooksSection
          webhooks={webhooks}
          webhookName={webhookName}
          onWebhookNameChange={setWebhookName}
          webhookUrl={webhookUrl}
          onWebhookUrlChange={setWebhookUrl}
          addingWebhook={addingWebhook}
          onAddWebhook={handleAddWebhook}
          testingWebhookId={testingWebhookId}
          onTestWebhook={handleTestWebhook}
          onRequestConfirm={setConfirmAction}
        />
      )}

      {activeSection === "schedules" && (
        <SchedulesSection
          schedules={schedules}
          scheduleUrl={scheduleUrl}
          onScheduleUrlChange={setScheduleUrl}
          scheduleFreq={scheduleFreq}
          onScheduleFreqChange={setScheduleFreq}
          addingSchedule={addingSchedule}
          onAddSchedule={handleAddSchedule}
          onRequestConfirm={setConfirmAction}
          scheduleTimestamp={scheduleTimestamp}
        />
      )}

      {activeSection === "github" && (
        <GithubSection setError={setError} setSuccess={setSuccess} />
      )}

      {/* Every rotate/revoke/delete above opens here instead of firing
          immediately: none of those actions can be undone once the
          request lands. */}
      <AlertDialog
        open={confirmAction !== null}
        onOpenChange={(open) => {
          if (!open && !confirmBusy) setConfirmAction(null);
        }}
      >
        {confirmAction && confirmCopy && (
          <AlertDialogContent className="sm:max-w-md">
            <AlertDialogHeader>
              <AlertDialogTitle>{confirmCopy.title}</AlertDialogTitle>
              <AlertDialogDescription className="text-left">
                {confirmCopy.description}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="flex-col-reverse sm:flex-row gap-2">
              <Button
                variant="outline"
                onClick={() => setConfirmAction(null)}
                disabled={confirmBusy}
              >
                Cancel
              </Button>
              <Button
                variant={confirmCopy.destructive ? "destructive" : "default"}
                onClick={handleConfirmDestructive}
                disabled={confirmBusy}
                className="gap-2"
              >
                {confirmBusy && (
                  <Loader2
                    className="h-4 w-4 animate-spin"
                    aria-hidden="true"
                  />
                )}
                {confirmCopy.confirmLabel}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        )}
      </AlertDialog>
    </div>
  );
}
