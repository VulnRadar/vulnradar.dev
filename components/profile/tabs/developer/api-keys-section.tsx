"use client";

import type { RefObject } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/ui/utils";
import {
  Key,
  Plus,
  Eye,
  EyeOff,
  Copy,
  Check,
  RefreshCw,
  ShieldOff,
  Loader2,
} from "lucide-react";
import {
  ALL_API_KEY_SCOPES,
  API_KEY_SCOPE_LABELS,
  resolveApiKeyScopes,
  type ApiKeyScope,
} from "@/lib/config/constants";
import type { ApiKey } from "@/components/profile/types";
import type { ConfirmAction } from "./types";

interface ApiKeysSectionProps {
  apiKeys: ApiKey[];
  maxActiveKeys: number;
  newKeyName: string;
  onNewKeyNameChange: (value: string) => void;
  newKeyScopes: ApiKeyScope[];
  onToggleScope: (scope: ApiKeyScope) => void;
  generatingKey: boolean;
  onGenerateKey: () => void;
  newlyCreatedKey: string | null;
  showKey: boolean;
  onToggleShowKey: () => void;
  copiedKey: boolean;
  onCopyKey: () => void;
  onDismissNewKey: () => void;
  newKeyPanelRef: RefObject<HTMLDivElement | null>;
  keyActionPending: { id: number; kind: "rotate" | "revoke" } | null;
  onRequestConfirm: (action: ConfirmAction) => void;
  formatDate: (dateStr: string | null) => string;
}

/** Checkbox row for one scope, used by the "Create key" form below. */
function ScopeCheckbox({
  scope,
  checked,
  onToggle,
}: {
  scope: ApiKeyScope;
  checked: boolean;
  onToggle: () => void;
}) {
  const id = `new-key-scope-${scope}`;
  return (
    <label
      htmlFor={id}
      className="flex items-start gap-2 py-1 cursor-pointer select-none"
    >
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={onToggle}
        className="mt-0.5"
      />
      <span className="text-sm text-foreground leading-snug">
        {API_KEY_SCOPE_LABELS[scope]}
        <span className="ml-1.5 font-mono text-[11px] text-muted-foreground">
          {scope}
        </span>
      </span>
    </label>
  );
}

/** Small pill row summarizing what a key can do -- shown per key in the
 * list below, and shared between the empty-state and has-keys create
 * forms above. */
function ScopePills({ scopes }: { scopes: string[] | null | undefined }) {
  const isLegacy = scopes == null;
  const resolved = resolveApiKeyScopes(scopes);
  return (
    <div className="flex flex-wrap gap-1">
      {isLegacy ? (
        <span
          className="rounded-full border border-border bg-muted/50 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
          title="Created before scopes existed, keeps its original full access."
        >
          All scopes (legacy key)
        </span>
      ) : (
        resolved.map((scope) => (
          <span
            key={scope}
            className="rounded-full border border-primary/20 bg-primary/[0.06] px-1.5 py-0.5 text-[10px] font-medium text-primary"
          >
            {API_KEY_SCOPE_LABELS[scope]}
          </span>
        ))
      )}
    </div>
  );
}

/**
 * API Keys sub-section of the Developer tab. Purely presentational: all
 * state and API calls live in the Developer tab shell so the confirmation
 * dialog (shared with Webhooks/Scheduled Scans) has one place to own
 * rotate/revoke instead of duplicating that flow per section.
 */
export function ApiKeysSection({
  apiKeys,
  maxActiveKeys,
  newKeyName,
  onNewKeyNameChange,
  newKeyScopes,
  onToggleScope,
  generatingKey,
  onGenerateKey,
  newlyCreatedKey,
  showKey,
  onToggleShowKey,
  copiedKey,
  onCopyKey,
  onDismissNewKey,
  newKeyPanelRef,
  keyActionPending,
  onRequestConfirm,
  formatDate,
}: ApiKeysSectionProps) {
  const activeKeys = apiKeys.filter(
    (k) => k && typeof k === "object" && !k.revoked_at,
  );
  const unlimitedKeys = maxActiveKeys === -1;
  const atKeyLimit = !unlimitedKeys && activeKeys.length >= maxActiveKeys;

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-base font-semibold tracking-tight text-foreground">
              API keys
            </h2>
            {activeKeys.length > 0 && (
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
                  atKeyLimit
                    ? "bg-destructive/10 text-destructive"
                    : "bg-primary/10 text-primary",
                )}
              >
                <Key className="h-3 w-3" aria-hidden="true" />
                {unlimitedKeys
                  ? `${activeKeys.length} active`
                  : `${activeKeys.length}/${maxActiveKeys} active`}
              </span>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">
            Authenticate scans from your own code. Each key has its own daily
            request budget, set by your plan.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 shrink-0"
          asChild
        >
          <a href="/docs">Read the API docs</a>
        </Button>
      </div>

      {/* The one and only sighting of a new key. */}
      {newlyCreatedKey && (
        <div
          ref={newKeyPanelRef}
          tabIndex={-1}
          className="rounded-xl border border-primary/40 bg-primary/[0.05] p-4 sm:p-5 flex flex-col gap-3 outline-none"
        >
          <div className="flex items-start gap-2.5">
            <Key
              className="h-4 w-4 text-primary shrink-0 mt-0.5"
              aria-hidden="true"
            />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground">
                Copy this key now
              </p>
              <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                It is stored hashed, so this is the only time it can be
                displayed. If you lose it, rotate the key to get a new one.
              </p>
            </div>
          </div>

          <code className="block w-full rounded-lg border border-border bg-card px-3 py-2.5 font-mono text-xs text-foreground overflow-x-auto whitespace-pre">
            {showKey
              ? newlyCreatedKey
              : newlyCreatedKey.slice(0, 12) + "..." + "*".repeat(32)}
          </code>

          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={onCopyKey} className="gap-2">
              {copiedKey ? (
                <Check className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Copy className="h-4 w-4" aria-hidden="true" />
              )}
              {copiedKey ? "Copied to clipboard" : "Copy key"}
            </Button>
            <Button
              variant="outline"
              onClick={onToggleShowKey}
              className="gap-2"
              aria-pressed={showKey}
            >
              {showKey ? (
                <EyeOff className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Eye className="h-4 w-4" aria-hidden="true" />
              )}
              {showKey ? "Hide" : "Reveal"}
            </Button>
            <Button
              variant="ghost"
              className="ml-auto text-muted-foreground"
              onClick={onDismissNewKey}
            >
              Done
            </Button>
          </div>
          <p className="sr-only" role="status" aria-live="polite">
            {copiedKey ? "API key copied to clipboard." : ""}
          </p>
        </div>
      )}

      {/* Active keys, or an invitation to make the first one */}
      {activeKeys.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-muted/20 p-5 sm:p-6 flex flex-col gap-3">
          <div>
            <p className="text-sm font-semibold text-foreground">
              Make your first key
            </p>
            <p className="text-sm text-muted-foreground mt-1 max-w-prose leading-relaxed">
              A key lets you start scans from CI, a script, or your own backend,
              without signing in. Name it after where it will live so you know
              which one to rotate later.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-2 max-w-xl">
            <div className="flex-1 flex flex-col gap-1.5">
              <Label htmlFor="key-name" className="sr-only">
                Name for the new API key
              </Label>
              <Input
                id="key-name"
                placeholder="Production, CI, staging box..."
                value={newKeyName}
                onChange={(e) => onNewKeyNameChange(e.target.value)}
                className="h-10"
                maxLength={100}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !atKeyLimit) onGenerateKey();
                }}
              />
            </div>
            <Button
              onClick={onGenerateKey}
              disabled={generatingKey || newKeyScopes.length === 0}
              className="shrink-0 h-10 gap-2"
            >
              {generatingKey ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Plus className="h-4 w-4" aria-hidden="true" />
              )}
              {generatingKey ? "Creating..." : "Create key"}
            </Button>
          </div>
          <div className="max-w-xl rounded-lg border border-border/60 bg-card/50 px-3 py-2">
            <p className="text-xs font-medium text-muted-foreground mb-0.5">
              What this key can do
            </p>
            {ALL_API_KEY_SCOPES.map((scope) => (
              <ScopeCheckbox
                key={scope}
                scope={scope}
                checked={newKeyScopes.includes(scope)}
                onToggle={() => onToggleScope(scope)}
              />
            ))}
            {newKeyScopes.length === 0 && (
              <p className="text-xs text-destructive mt-1">
                Select at least one scope.
              </p>
            )}
          </div>
        </div>
      ) : (
        <>
          <ul className="flex flex-col gap-2">
            {activeKeys.map((key) => {
              const pct = Math.min(
                100,
                (key.usage_today / key.daily_limit) * 100,
              );
              return (
                <li
                  key={key.id}
                  className="rounded-xl border border-border bg-card p-4 flex flex-col gap-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-sm font-medium text-foreground truncate">
                          {key.name}
                        </span>
                        <code className="shrink-0 rounded border border-border bg-muted/50 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                          {key.key_prefix}...
                        </code>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        Created {formatDate(key.created_at)}
                        {key.last_used_at
                          ? `, last used ${formatDate(key.last_used_at)}`
                          : ", never used"}
                      </p>
                      <div className="mt-1.5">
                        <ScopePills scopes={key.scopes} />
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          onRequestConfirm({
                            kind: "rotate-key",
                            id: key.id,
                            label: key.name,
                          })
                        }
                        disabled={keyActionPending?.id === key.id}
                        className="text-muted-foreground hover:text-foreground h-8 gap-1.5"
                        aria-label={`Rotate the key named ${key.name}`}
                      >
                        <RefreshCw
                          className={cn(
                            "h-3.5 w-3.5",
                            keyActionPending?.id === key.id &&
                              keyActionPending.kind === "rotate" &&
                              "animate-spin",
                          )}
                          aria-hidden="true"
                        />
                        <span className="hidden sm:inline">Rotate</span>
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          onRequestConfirm({
                            kind: "revoke-key",
                            id: key.id,
                            label: key.name,
                          })
                        }
                        disabled={keyActionPending?.id === key.id}
                        className="text-muted-foreground hover:text-destructive h-8 gap-1.5"
                        aria-label={`Revoke the key named ${key.name}`}
                      >
                        <ShieldOff
                          className={cn(
                            "h-3.5 w-3.5",
                            keyActionPending?.id === key.id &&
                              keyActionPending.kind === "revoke" &&
                              "animate-spin",
                          )}
                          aria-hidden="true"
                        />
                        <span className="hidden sm:inline">Revoke</span>
                      </Button>
                    </div>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>Requests today</span>
                      <span className="tabular-nums">
                        {key.usage_today} of {key.daily_limit}
                      </span>
                    </div>
                    <Progress value={pct} className="h-1.5" />
                  </div>
                </li>
              );
            })}
          </ul>

          <div className="flex flex-col sm:flex-row gap-2 items-start sm:items-center">
            <div className="flex-1 w-full sm:w-auto">
              <Label htmlFor="key-name" className="sr-only">
                Name for the new API key
              </Label>
              <Input
                id="key-name"
                placeholder="Name another key..."
                value={newKeyName}
                onChange={(e) => onNewKeyNameChange(e.target.value)}
                className="h-10"
                maxLength={100}
                disabled={atKeyLimit}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !atKeyLimit) onGenerateKey();
                }}
              />
            </div>
            <Button
              variant="outline"
              onClick={onGenerateKey}
              disabled={
                generatingKey || atKeyLimit || newKeyScopes.length === 0
              }
              className="shrink-0 h-10 gap-2 w-full sm:w-auto"
            >
              {generatingKey ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Plus className="h-4 w-4" aria-hidden="true" />
              )}
              {generatingKey ? "Creating..." : "Create key"}
            </Button>
          </div>
          {!atKeyLimit && (
            <div className="rounded-lg border border-border/60 bg-card/50 px-3 py-2">
              <p className="text-xs font-medium text-muted-foreground mb-0.5">
                What the new key can do
              </p>
              {ALL_API_KEY_SCOPES.map((scope) => (
                <ScopeCheckbox
                  key={scope}
                  scope={scope}
                  checked={newKeyScopes.includes(scope)}
                  onToggle={() => onToggleScope(scope)}
                />
              ))}
              {newKeyScopes.length === 0 && (
                <p className="text-xs text-destructive mt-1">
                  Select at least one scope.
                </p>
              )}
            </div>
          )}
          <p className="text-xs text-muted-foreground -mt-1">
            {unlimitedKeys
              ? `${activeKeys.length} key slot${activeKeys.length === 1 ? "" : "s"} in use. Your plan has no limit.`
              : atKeyLimit
                ? `You are using all ${maxActiveKeys} key slots. Rotate one in place, or revoke a key to free a slot.`
                : `${activeKeys.length} of ${maxActiveKeys} key slots in use.`}
          </p>
        </>
      )}
    </section>
  );
}
