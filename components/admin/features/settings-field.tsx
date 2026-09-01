"use client";

import { useState } from "react";
import { Loader2, RotateCcw, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/ui/utils";
import type { SettingDefinition, SettingKey } from "@/lib/config/registry";
import {
  looksLikeEmail,
  looksLikeUrl,
  isListSetting,
  isMultilineSetting,
  type FieldValue,
} from "./settings-registry-utils";

/**
 * Tag/chip editor for a setting stored as one comma-separated string (see
 * `isListSetting`). Keeps the stored representation unchanged, just gives
 * a long unbroken string like the SEO keywords list a readable, editable
 * shape instead of one giant text input.
 */
function ListValueEditor({
  id,
  value,
  onChange,
  ariaLabel,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
}) {
  const [draft, setDraft] = useState("");
  const items = value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const commitDraft = () => {
    const next = draft.trim();
    setDraft("");
    if (!next || items.includes(next)) return;
    onChange([...items, next].join(", "));
  };

  const removeAt = (index: number) => {
    onChange(items.filter((_, i) => i !== index).join(", "));
  };

  return (
    <div className="w-48 sm:w-64">
      {items.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-1.5">
          {items.map((item, i) => (
            <span
              key={`${item}-${i}`}
              className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full bg-primary/10 text-primary text-xs border border-primary/20"
            >
              {item}
              <button
                type="button"
                onClick={() => removeAt(i)}
                // a11y (target size): p-0.5 around a 10px icon computed to a
                // 14x14 hit area, and these chips wrap in a dense row so the
                // spacing exception does not rescue it either. The mark stays
                // 10px; only the box around it grows to 24.
                className="inline-flex h-6 w-6 items-center justify-center rounded-full hover:bg-primary/20"
                aria-label={`Remove ${item}`}
              >
                <X className="h-2.5 w-2.5" aria-hidden="true" />
              </button>
            </span>
          ))}
        </div>
      )}
      <Input
        id={id}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            commitDraft();
          } else if (
            e.key === "Backspace" &&
            draft === "" &&
            items.length > 0
          ) {
            removeAt(items.length - 1);
          }
        }}
        onBlur={commitDraft}
        placeholder="Add a keyword and press Enter..."
        aria-label={ariaLabel}
        className="h-9 bg-background/50 border-border/40 focus:border-primary/50"
      />
    </div>
  );
}

interface SettingFieldProps {
  fieldKey: SettingKey;
  def: SettingDefinition;
  value: FieldValue;
  isOverridden: boolean;
  isPending: boolean;
  isResetting: boolean;
  onChange: (key: SettingKey, value: FieldValue) => void;
  onResetRequest: (key: SettingKey) => void;
}

export function SettingField({
  fieldKey,
  def,
  value,
  isOverridden,
  isPending,
  isResetting,
  onChange,
  onResetRequest,
}: SettingFieldProps) {
  const stringValue = typeof value === "boolean" ? "" : String(value);
  const formatHint =
    def.type === "email" && !looksLikeEmail(stringValue)
      ? "Doesn't look like an email address."
      : def.type === "url" && !looksLikeUrl(stringValue)
        ? "Doesn't look like a URL."
        : null;

  return (
    <div className="px-4 sm:px-5 py-4 hover:bg-muted/20 transition-colors">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <label
              htmlFor={`setting-${fieldKey}`}
              className="text-sm font-medium text-foreground"
            >
              {def.label}
            </label>
            <Badge
              variant="outline"
              className={cn(
                "text-[10px] px-1.5 py-0 font-normal",
                isOverridden
                  ? "bg-primary/10 text-primary border-primary/20"
                  : "text-muted-foreground border-border/50",
              )}
            >
              {isOverridden ? "Customized" : "Default"}
            </Badge>
            {isPending && (
              <span
                className="h-1.5 w-1.5 rounded-full bg-primary"
                aria-label="Unsaved change"
                title="Unsaved change"
              />
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-1 max-w-[52ch]">
            {def.help}
          </p>
          {formatHint && (
            <p className="text-xs text-[hsl(var(--warning))] mt-1">
              {formatHint}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {def.type === "bool" && (
            <Switch
              id={`setting-${fieldKey}`}
              checked={Boolean(value)}
              onCheckedChange={(checked) => onChange(fieldKey, checked)}
              aria-label={def.label}
            />
          )}

          {(def.type === "int" || def.type === "float") && (
            <Input
              id={`setting-${fieldKey}`}
              type="number"
              min={def.min}
              max={def.max}
              step={def.type === "float" ? "any" : 1}
              value={stringValue}
              onChange={(e) => onChange(fieldKey, e.target.value)}
              className="w-28 sm:w-32 h-9 bg-background/50 border-border/40 focus:border-primary/50"
            />
          )}

          {def.type === "enum" && (
            <Select
              value={stringValue}
              onValueChange={(v) => onChange(fieldKey, v)}
            >
              <SelectTrigger
                id={`setting-${fieldKey}`}
                className="w-36 h-9 bg-background/50 border-border/40"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(def.options ?? []).map((option) => (
                  <SelectItem key={option} value={option}>
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {def.type === "string" && isListSetting(fieldKey) && (
            <ListValueEditor
              id={`setting-${fieldKey}`}
              value={stringValue}
              onChange={(v) => onChange(fieldKey, v)}
              ariaLabel={def.label}
            />
          )}

          {def.type === "string" &&
            !isListSetting(fieldKey) &&
            isMultilineSetting(fieldKey) && (
              <Textarea
                id={`setting-${fieldKey}`}
                value={stringValue}
                onChange={(e) => onChange(fieldKey, e.target.value)}
                rows={3}
                maxLength={def.max}
                className="w-full sm:w-80 resize-y bg-background/50 border-border/40 focus:border-primary/50"
              />
            )}

          {(def.type === "string" ||
            def.type === "email" ||
            def.type === "url") &&
            !isListSetting(fieldKey) &&
            !isMultilineSetting(fieldKey) && (
              <Input
                id={`setting-${fieldKey}`}
                type={
                  def.type === "email"
                    ? "email"
                    : def.type === "url"
                      ? "url"
                      : "text"
                }
                value={stringValue}
                onChange={(e) => onChange(fieldKey, e.target.value)}
                className="w-48 sm:w-64 h-9 bg-background/50 border-border/40 focus:border-primary/50"
              />
            )}

          {isOverridden && (
            <Button
              variant="ghost"
              size="sm"
              className="h-9 w-9 p-0"
              onClick={() => onResetRequest(fieldKey)}
              disabled={isResetting}
              aria-label={`Reset ${def.label} to default`}
              title="Reset to default"
            >
              {isResetting ? (
                <Loader2
                  className="h-3.5 w-3.5 animate-spin"
                  aria-hidden="true"
                />
              ) : (
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              )}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
