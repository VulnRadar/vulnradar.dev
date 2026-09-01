"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/ui/utils";
import { copyToClipboard } from "@/lib/ui/clipboard";
import {
  Key,
  Webhook,
  CalendarClock,
  ShieldCheck,
  Loader2,
  ArrowRight,
  type LucideIcon,
} from "lucide-react";
import {
  API,
  DEFAULT_NEW_KEY_SCOPES,
  ROUTES,
  type ApiKeyScope,
} from "@/lib/config/client-constants";
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
import { DeveloperTabSkeleton } from "./developer/developer-tab-skeleton";
import {
  localHourToUtc,
  localHourAndDowToUtc,
  localHourAndDomToUtc,
} from "./developer/schedule-time-utils";

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

// The Developer tab used to be one long scroll of API keys, webhooks, and
// scheduled scans. It's now sub-tabs so each is independently scannable.
// This is a client-side sub-tab (like the top-level profile tabs), not
// separate routes, because /profile has no per-tab routing to plug into:
// the whole page is one client component keyed off a `tab` query param.
//
// GitHub repo scanning used to be a fourth sub-tab here. It's now its own
// page (app/repos, "Repos" in the main nav) with repo access granted from
// the Social tab's GitHub card instead of a "Connect" button in this tab
// -- see components/profile/tabs/profile-social-tab.tsx's
// GithubRepoAccessSection and app/profile/page.tsx's handling of the
// OAuth callback's dtab=github landing.
const DEVELOPER_SECTIONS: Array<{
  id: DeveloperSection;
  label: string;
  icon: LucideIcon;
}> = [
  { id: "api-keys", label: "API Keys", icon: Key },
  { id: "webhooks", label: "Webhooks", icon: Webhook },
  { id: "schedules", label: "Scheduled Scans", icon: CalendarClock },
];

// "domains" is deliberately not in the strip above. Verified domains moved to
// /attack-surface, and a sub-tab that looks like the three real ones but only
// ever renders a "this moved" card costs a click and teaches nothing. The
// section itself is still reachable, so an existing ?dtab=domains bookmark or
// link lands on the pointer instead of silently falling back to API Keys.
const REDIRECTED_SECTIONS = ["domains"] as const;

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
  return (
    DEVELOPER_SECTIONS.some((s) => s.id === value) ||
    (REDIRECTED_SECTIONS as readonly string[]).includes(value)
  );
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
  const { me, isStaff } = useAuth();
  // Staff get every premium limit/feature this tab gates behind a plan,
  // same as the server already does (userMeetsScheduleFrequency and every
  // other plan-tier check bypasses for role=staff/admin/etc.) -- without
  // this, a staff account's own raw `plan` column (usually "free", since
  // staff don't need a paid subscription) would show every plan-gated
  // control here as locked, contradicting what the backend actually allows.
  const effectivePlan = isStaff ? "elite_supporter" : (me?.plan ?? "free");
  const apiKeyLimit = getPlanById(effectivePlan)?.limits.apiKeys ?? 1;

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
  // scoping: defaults to scan:write + scan:read (not scan:delete) -- the
  // same non-destructive default the server falls back to when scopes are
  // omitted entirely, kept in sync here so the checkboxes' starting state
  // matches what a user who ignores them would actually get.
  const [newKeyScopes, setNewKeyScopes] = useState<ApiKeyScope[]>(
    DEFAULT_NEW_KEY_SCOPES,
  );
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
  // Shown once, right after creation, then discarded -- same "shown once"
  // contract as newlyCreatedKey above; the server never returns it again.
  const [newlyCreatedWebhookSecret, setNewlyCreatedWebhookSecret] = useState<
    string | null
  >(null);
  const [togglingWebhookId, setTogglingWebhookId] = useState<number | null>(
    null,
  );
  const [editingWebhookId, setEditingWebhookId] = useState<number | null>(null);
  const [editWebhookName, setEditWebhookName] = useState("");
  const [editWebhookUrl, setEditWebhookUrl] = useState("");
  const [savingWebhookEdit, setSavingWebhookEdit] = useState(false);

  // Schedules state. Hour/day-of-week/day-of-month are held in the user's
  // own local time (see components/profile/tabs/developer/schedule-time-utils.ts
  // for the UTC conversion, applied once at submit) and default to "now" so
  // a user who never touches these controls gets a schedule anchored to
  // roughly when they created it, the same behavior a plain "now + interval"
  // used to produce implicitly.
  const [scheduleUrl, setScheduleUrl] = useState("");
  const [scheduleFreq, setScheduleFreq] = useState("weekly");
  const [scheduleHourLocal, setScheduleHourLocal] = useState(() =>
    new Date().getHours(),
  );
  const [scheduleDayOfWeekLocal, setScheduleDayOfWeekLocal] = useState(() =>
    new Date().getDay(),
  );
  const [scheduleDayOfMonthLocal, setScheduleDayOfMonthLocal] = useState(() =>
    Math.min(new Date().getDate(), 28),
  );
  const [addingSchedule, setAddingSchedule] = useState(false);
  const [togglingScheduleId, setTogglingScheduleId] = useState<number | null>(
    null,
  );

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
  function handleToggleNewKeyScope(scope: ApiKeyScope) {
    setNewKeyScopes((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope],
    );
  }

  async function handleGenerateKey() {
    if (atKeyLimit) {
      setError(
        `Your plan allows up to ${apiKeyLimit} active keys. Rotate one, or revoke it first.`,
      );
      return;
    }
    if (newKeyScopes.length === 0) {
      setError("Select at least one scope for the new key.");
      return;
    }
    setGeneratingKey(true);
    setError(null);
    try {
      const body = { name: newKeyName || "Default", scopes: newKeyScopes };

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
      // API returns { key: { id, key_prefix, name, daily_limit, created_at, scopes, raw_key } }
      const keyRecord = data.key;

      setNewlyCreatedKey(keyRecord.raw_key);
      setNewKeyScopes(DEFAULT_NEW_KEY_SCOPES);
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

  async function handleToggleSchedule(id: number, active: boolean) {
    setError(null);
    setTogglingScheduleId(id);
    try {
      const res = await fetch(API.SCHEDULES, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, active }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to update the schedule.");
        return;
      }
      setSchedules((prev) => prev.map((s) => (s.id === id ? data : s)));
      setSuccess(active ? "Schedule resumed." : "Schedule paused.");
    } catch {
      setError("Failed to update the schedule.");
    } finally {
      setTogglingScheduleId(null);
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
    if (await copyToClipboard(newlyCreatedKey)) {
      setCopiedKey(true);
      setTimeout(() => setCopiedKey(false), 2000);
    } else {
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
        // `secret` is only ever present on this create response -- pulled
        // out here so it never lingers in the webhooks list state, only in
        // the one-time reveal panel.
        const { secret, ...webhookRecord } = data;
        setWebhooks((prev) => [webhookRecord, ...prev]);
        setNewlyCreatedWebhookSecret(secret ?? null);
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

  async function handleToggleWebhookActive(id: number, nextActive: boolean) {
    setTogglingWebhookId(id);
    setError(null);
    try {
      const res = await fetch(`${API.WEBHOOKS}/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: nextActive }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to update webhook.");
        return;
      }
      setWebhooks((prev) =>
        prev.map((w) => (w.id === id ? { ...w, active: data.active } : w)),
      );
      setSuccess(nextActive ? "Webhook resumed." : "Webhook paused.");
    } catch {
      setError("Failed to update webhook.");
    } finally {
      setTogglingWebhookId(null);
    }
  }

  function handleStartEditWebhook(webhook: WebhookItem) {
    setEditingWebhookId(webhook.id);
    setEditWebhookName(webhook.name);
    setEditWebhookUrl(webhook.url);
  }

  function handleCancelEditWebhook() {
    setEditingWebhookId(null);
    setEditWebhookName("");
    setEditWebhookUrl("");
  }

  async function handleSaveWebhookEdit() {
    if (editingWebhookId === null) return;
    setSavingWebhookEdit(true);
    setError(null);
    try {
      const res = await fetch(`${API.WEBHOOKS}/${editingWebhookId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editWebhookName || "Default",
          url: editWebhookUrl,
          type: "auto",
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to update webhook.");
        return;
      }
      setWebhooks((prev) =>
        prev.map((w) => (w.id === editingWebhookId ? { ...w, ...data } : w)),
      );
      setSuccess("Webhook updated.");
      handleCancelEditWebhook();
    } catch {
      setError("Failed to update webhook.");
    } finally {
      setSavingWebhookEdit(false);
    }
  }

  async function handleAddSchedule() {
    setAddingSchedule(true);
    try {
      // Convert the local-time picker selections to UTC once, here, right
      // before sending -- everything downstream (the API, the worker's
      // next_run_at recomputation) works in UTC only. Day-of-week/
      // day-of-month are converted jointly with the hour since a late-night
      // local selection can land on a different UTC day.
      let preferredHourUtc = localHourToUtc(scheduleHourLocal);
      let preferredDayOfWeek = new Date().getDay();
      let preferredDayOfMonth = Math.min(new Date().getDate(), 28);
      if (scheduleFreq === "weekly") {
        const converted = localHourAndDowToUtc(
          scheduleHourLocal,
          scheduleDayOfWeekLocal,
        );
        preferredHourUtc = converted.hourUtc;
        preferredDayOfWeek = converted.dowUtc;
      } else if (scheduleFreq === "monthly") {
        const converted = localHourAndDomToUtc(
          scheduleHourLocal,
          scheduleDayOfMonthLocal,
        );
        preferredHourUtc = converted.hourUtc;
        preferredDayOfMonth = converted.domUtc;
      }

      const res = await fetch(API.SCHEDULES, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: scheduleUrl,
          frequency: scheduleFreq,
          preferredHourUtc,
          preferredDayOfWeek,
          preferredDayOfMonth,
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
    return <DeveloperTabSkeleton />;
  }

  const sectionCount = (id: DeveloperSection) => {
    if (id === "api-keys") return activeKeys.length;
    if (id === "webhooks") return webhooks.length;
    if (id === "schedules") return schedules.length;
    return 0;
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Developer sub-tabs: API Keys / Webhooks / Scheduled Scans, each
          independently scannable instead of one long scroll. */}
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
                    "inline-flex items-center justify-center min-w-5 h-5 rounded-full px-1 text-[11px] font-medium tabular-nums",
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
          newKeyScopes={newKeyScopes}
          onToggleScope={handleToggleNewKeyScope}
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
          newlyCreatedWebhookSecret={newlyCreatedWebhookSecret}
          onDismissNewWebhookSecret={() => setNewlyCreatedWebhookSecret(null)}
          togglingWebhookId={togglingWebhookId}
          onToggleWebhookActive={handleToggleWebhookActive}
          editingWebhookId={editingWebhookId}
          editWebhookName={editWebhookName}
          onEditWebhookNameChange={setEditWebhookName}
          editWebhookUrl={editWebhookUrl}
          onEditWebhookUrlChange={setEditWebhookUrl}
          savingWebhookEdit={savingWebhookEdit}
          onStartEditWebhook={handleStartEditWebhook}
          onCancelEditWebhook={handleCancelEditWebhook}
          onSaveWebhookEdit={handleSaveWebhookEdit}
        />
      )}

      {activeSection === "domains" && (
        <div className="rounded-lg border border-border/60 bg-card p-5 sm:p-6">
          <div className="flex items-start gap-3">
            <div className="rounded-lg border border-primary/20 bg-primary/10 p-2 text-primary">
              <ShieldCheck className="h-5 w-5" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-semibold text-foreground">
                Domain verification moved to Attack Surface
              </h3>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                Verified domains now live in one place: the Attack Surface page,
                where they double as your scanned-domain portfolio. Add, verify,
                and remove domains there.
              </p>
              <Link
                href={ROUTES.ATTACK_SURFACE}
                className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline underline-offset-4"
              >
                Go to Attack Surface
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
            </div>
          </div>
        </div>
      )}

      {activeSection === "schedules" && (
        <SchedulesSection
          schedules={schedules}
          scheduleUrl={scheduleUrl}
          onScheduleUrlChange={setScheduleUrl}
          scheduleFreq={scheduleFreq}
          onScheduleFreqChange={setScheduleFreq}
          scheduleHourLocal={scheduleHourLocal}
          onScheduleHourLocalChange={setScheduleHourLocal}
          scheduleDayOfWeekLocal={scheduleDayOfWeekLocal}
          onScheduleDayOfWeekLocalChange={setScheduleDayOfWeekLocal}
          scheduleDayOfMonthLocal={scheduleDayOfMonthLocal}
          onScheduleDayOfMonthLocalChange={setScheduleDayOfMonthLocal}
          addingSchedule={addingSchedule}
          onAddSchedule={handleAddSchedule}
          onRequestConfirm={setConfirmAction}
          scheduleTimestamp={scheduleTimestamp}
          userPlan={effectivePlan}
          onToggleSchedule={handleToggleSchedule}
          togglingScheduleId={togglingScheduleId}
        />
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
