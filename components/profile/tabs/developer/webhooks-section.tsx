"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/ui/utils";
import { copyToClipboard } from "@/lib/ui/clipboard";
import {
  Plus,
  Play,
  Trash2,
  Globe,
  Loader2,
  Pencil,
  Check,
  X,
  KeyRound,
  Copy,
} from "lucide-react";
import { useState } from "react";
import type { WebhookItem } from "@/components/profile/types";
import type { ConfirmAction } from "./types";

interface WebhooksSectionProps {
  webhooks: WebhookItem[];
  webhookName: string;
  onWebhookNameChange: (value: string) => void;
  webhookUrl: string;
  onWebhookUrlChange: (value: string) => void;
  addingWebhook: boolean;
  onAddWebhook: () => void;
  testingWebhookId: number | null;
  onTestWebhook: (id: number) => void;
  onRequestConfirm: (action: ConfirmAction) => void;
  /** The secret is only ever returned by the create response -- shown once
   *  here, then never displayed again (not even to the owner). */
  newlyCreatedWebhookSecret: string | null;
  onDismissNewWebhookSecret: () => void;
  togglingWebhookId: number | null;
  onToggleWebhookActive: (id: number, nextActive: boolean) => void;
  editingWebhookId: number | null;
  editWebhookName: string;
  onEditWebhookNameChange: (value: string) => void;
  editWebhookUrl: string;
  onEditWebhookUrlChange: (value: string) => void;
  savingWebhookEdit: boolean;
  onStartEditWebhook: (webhook: WebhookItem) => void;
  onCancelEditWebhook: () => void;
  onSaveWebhookEdit: () => void;
}

/**
 * Webhooks sub-section of the Developer tab. Purely presentational: the
 * shell owns the form state and API calls so add/test/edit/pause/delete all
 * update the same webhooks list without this section needing its own copy
 * of it.
 */
export function WebhooksSection({
  webhooks,
  webhookName,
  onWebhookNameChange,
  webhookUrl,
  onWebhookUrlChange,
  addingWebhook,
  onAddWebhook,
  testingWebhookId,
  onTestWebhook,
  onRequestConfirm,
  newlyCreatedWebhookSecret,
  onDismissNewWebhookSecret,
  togglingWebhookId,
  onToggleWebhookActive,
  editingWebhookId,
  editWebhookName,
  onEditWebhookNameChange,
  editWebhookUrl,
  onEditWebhookUrlChange,
  savingWebhookEdit,
  onStartEditWebhook,
  onCancelEditWebhook,
  onSaveWebhookEdit,
}: WebhooksSectionProps) {
  const [copiedSecret, setCopiedSecret] = useState(false);

  async function handleCopySecret() {
    if (!newlyCreatedWebhookSecret) return;
    if (await copyToClipboard(newlyCreatedWebhookSecret)) {
      setCopiedSecret(true);
      setTimeout(() => setCopiedSecret(false), 2000);
    }
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="min-w-0">
        <h2 className="text-base font-semibold tracking-tight text-foreground">
          Where results get posted
        </h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          Send finished scans to Discord, Slack, or any endpoint that accepts
          JSON. Every delivery is signed so you can verify it actually came from
          us.
        </p>
      </div>

      {/* The one and only sighting of a new webhook's signing secret. */}
      {newlyCreatedWebhookSecret && (
        <div className="rounded-xl border border-primary/40 bg-primary/5 p-4 sm:p-5 flex flex-col gap-3">
          <div className="flex items-start gap-2.5">
            <KeyRound
              className="h-4 w-4 text-primary shrink-0 mt-0.5"
              aria-hidden="true"
            />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground">
                Copy this signing secret now
              </p>
              <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                Every delivery to this webhook is signed with it (
                <code className="font-mono">X-VulnRadar-Signature</code>, HMAC
                SHA-256). It is not stored anywhere you can view it again: if
                you lose it, delete this webhook and create a new one.
              </p>
            </div>
          </div>

          <code className="block w-full rounded-lg border border-border bg-card px-3 py-2.5 font-mono text-xs text-foreground overflow-x-auto whitespace-pre">
            {newlyCreatedWebhookSecret}
          </code>

          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={handleCopySecret} className="gap-2">
              {copiedSecret ? (
                <Check className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Copy className="h-4 w-4" aria-hidden="true" />
              )}
              {copiedSecret ? "Copied to clipboard" : "Copy secret"}
            </Button>
            <Button
              variant="ghost"
              className="ml-auto text-muted-foreground"
              onClick={onDismissNewWebhookSecret}
            >
              Done
            </Button>
          </div>
        </div>
      )}

      <Card className="border-border/50 bg-card/50">
        <CardContent className="pt-6 space-y-4">
          {/* Add webhook form */}
          <div className="flex flex-col gap-3 p-4 rounded-lg border border-border bg-secondary/30">
            <div className="flex flex-col sm:flex-row gap-2">
              <div className="sm:w-44">
                <Label htmlFor="webhook-name" className="sr-only">
                  Webhook name
                </Label>
                <Input
                  id="webhook-name"
                  placeholder="Name (e.g. Discord Alerts)"
                  value={webhookName}
                  onChange={(e) => onWebhookNameChange(e.target.value)}
                  className="bg-card h-10 w-full"
                />
              </div>
              <div className="flex-1 min-w-0">
                <Label htmlFor="webhook-url" className="sr-only">
                  Webhook URL
                </Label>
                <Input
                  id="webhook-url"
                  placeholder="https://discord.com/api/webhooks/..."
                  value={webhookUrl}
                  onChange={(e) => onWebhookUrlChange(e.target.value)}
                  className="bg-card h-10 w-full"
                />
              </div>
              <Button
                disabled={!webhookUrl || addingWebhook}
                onClick={onAddWebhook}
                className="shrink-0"
              >
                {addingWebhook ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
                <span className="ml-1.5">Add</span>
              </Button>
            </div>
          </div>

          {/* Webhook list */}
          {webhooks.length === 0 ? (
            <p className="text-sm text-muted-foreground py-2 max-w-prose leading-relaxed">
              Nothing is listening yet. Paste a Discord or Slack webhook URL
              above and every finished scan will post there. We detect which
              service it is from the URL.
            </p>
          ) : (
            <div className="rounded-lg border border-border divide-y divide-border/60 overflow-hidden">
              {webhooks.map((wh) => {
                const isEditing = editingWebhookId === wh.id;
                const isToggling = togglingWebhookId === wh.id;

                if (isEditing) {
                  return (
                    <div
                      key={wh.id}
                      className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 px-4 py-3 bg-muted/20"
                    >
                      <Input
                        value={editWebhookName}
                        onChange={(e) =>
                          onEditWebhookNameChange(e.target.value)
                        }
                        placeholder="Name"
                        className="bg-card h-9 sm:w-44"
                        aria-label="Webhook name"
                      />
                      <Input
                        value={editWebhookUrl}
                        onChange={(e) => onEditWebhookUrlChange(e.target.value)}
                        placeholder="https://..."
                        className="bg-card h-9 flex-1 min-w-0"
                        aria-label="Webhook URL"
                      />
                      {/* h-11 (44px) on touch, back to h-8 from sm up: a
                          32px icon button is under the minimum tap target,
                          and save/cancel sitting a few pixels apart made
                          cancelling an edit by accident easy on a phone. */}
                      <div className="flex items-center gap-1 shrink-0 justify-end">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-11 w-11 sm:h-8 sm:w-8 text-primary hover:text-primary hover:bg-primary/10"
                          disabled={savingWebhookEdit || !editWebhookUrl}
                          onClick={onSaveWebhookEdit}
                          title="Save changes"
                          aria-label={`Save changes to ${wh.name}`}
                        >
                          {savingWebhookEdit ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Check className="h-4 w-4" />
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-11 w-11 sm:h-8 sm:w-8 text-muted-foreground hover:text-foreground"
                          disabled={savingWebhookEdit}
                          onClick={onCancelEditWebhook}
                          title="Cancel"
                          aria-label="Cancel editing"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  );
                }

                return (
                  <div
                    key={wh.id}
                    className={cn(
                      "flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors",
                      !wh.active && "opacity-60",
                    )}
                  >
                    {wh.type === "discord" ? (
                      <svg
                        className="h-4 w-4 text-[#5865F2] shrink-0"
                        viewBox="0 0 24 24"
                        fill="currentColor"
                      >
                        <path d="M20.317 4.37a19.791 19.791 0 00-4.885-1.515.074.074 0 00-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 00-5.487 0 12.64 12.64 0 00-.617-1.25.077.077 0 00-.079-.037A19.736 19.736 0 003.677 4.37a.07.07 0 00-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 00.031.057 19.9 19.9 0 005.993 3.03.078.078 0 00.084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 00-.041-.106 13.107 13.107 0 01-1.872-.892.077.077 0 01-.008-.128 10.2 10.2 0 00.372-.292.074.074 0 01.077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 01.078.01c.12.098.246.198.373.292a.077.077 0 01-.006.127 12.299 12.299 0 01-1.873.892.077.077 0 00-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 00.084.028 19.839 19.839 0 006.002-3.03.077.077 0 00.032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 00-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
                      </svg>
                    ) : wh.type === "slack" ? (
                      <svg
                        className="h-4 w-4 text-[#E01E5A] shrink-0"
                        viewBox="0 0 24 24"
                        fill="currentColor"
                      >
                        <path d="M5.042 15.165a2.528 2.528 0 01-2.52 2.523A2.528 2.528 0 010 15.165a2.527 2.527 0 012.522-2.52h2.52v2.52zm1.271 0a2.527 2.527 0 012.521-2.52 2.527 2.527 0 012.521 2.52v6.313A2.528 2.528 0 018.834 24a2.528 2.528 0 01-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 01-2.521-2.52A2.528 2.528 0 018.834 0a2.528 2.528 0 012.521 2.522v2.52H8.834zm0 1.271a2.528 2.528 0 012.521 2.521 2.528 2.528 0 01-2.521 2.521H2.522A2.528 2.528 0 010 8.834a2.528 2.528 0 012.522-2.521h6.312zm10.122 2.521a2.528 2.528 0 012.522-2.521A2.528 2.528 0 0124 8.834a2.528 2.528 0 01-2.522 2.521h-2.522V8.834zm-1.268 0a2.528 2.528 0 01-2.523 2.521 2.527 2.527 0 01-2.52-2.521V2.522A2.527 2.527 0 0115.165 0a2.528 2.528 0 012.523 2.522v6.312zm-2.523 10.122a2.528 2.528 0 012.523 2.522A2.528 2.528 0 0115.165 24a2.527 2.527 0 01-2.52-2.522v-2.522h2.52zm0-1.268a2.527 2.527 0 01-2.52-2.523 2.526 2.526 0 012.52-2.52h6.313A2.527 2.527 0 0124 15.165a2.528 2.528 0 01-2.522 2.523h-6.313z" />
                      </svg>
                    ) : (
                      <Globe className="h-4 w-4 text-primary shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-foreground truncate">
                          {wh.name}
                        </p>
                        <span
                          className={cn(
                            "inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider border shrink-0",
                            wh.type === "discord"
                              ? "bg-[#5865F2]/10 text-[#5865F2] border-[#5865F2]/20"
                              : wh.type === "slack"
                                ? "bg-[#E01E5A]/10 text-[#E01E5A] border-[#E01E5A]/20"
                                : "bg-muted text-muted-foreground border-border",
                          )}
                        >
                          {wh.type}
                        </span>
                        {!wh.active && (
                          <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider border border-border bg-muted text-muted-foreground shrink-0">
                            Paused
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground truncate font-mono">
                        {wh.url}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Switch
                        checked={wh.active}
                        disabled={isToggling}
                        onCheckedChange={(checked) =>
                          onToggleWebhookActive(wh.id, checked)
                        }
                        aria-label={
                          wh.active ? `Pause ${wh.name}` : `Resume ${wh.name}`
                        }
                        title={wh.active ? "Pause webhook" : "Resume webhook"}
                        className="mr-1"
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-10 w-10 sm:h-7 sm:w-7 text-muted-foreground hover:text-foreground"
                        onClick={() => onStartEditWebhook(wh)}
                        title="Edit webhook"
                        aria-label={`Edit webhook ${wh.name}`}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-10 w-10 sm:h-7 sm:w-7 text-primary hover:text-primary hover:bg-primary/10"
                        disabled={testingWebhookId === wh.id}
                        onClick={() => onTestWebhook(wh.id)}
                        title="Send test webhook"
                        aria-label={`Send test webhook to ${wh.name}`}
                      >
                        {testingWebhookId === wh.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Play className="h-3.5 w-3.5" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-10 w-10 sm:h-7 sm:w-7 text-destructive hover:text-destructive hover:bg-destructive/10"
                        onClick={() =>
                          onRequestConfirm({
                            kind: "delete-webhook",
                            id: wh.id,
                            label: wh.name,
                          })
                        }
                        title="Delete webhook"
                        aria-label={`Delete webhook ${wh.name}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
