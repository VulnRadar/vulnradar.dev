"use client";

import { useState, type ReactNode } from "react";
import { Loader2, RotateCcw, X } from "lucide-react";
import { StatusPill } from "@/components/admin/shared";
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
import {
  SETTINGS_REGISTRY,
  isWritableSetting,
  type SettingDefinition,
  type SettingKey,
} from "@/lib/config/registry";
import {
  compiledSourceFor,
  formatFieldValue,
  looksLikeEmail,
  looksLikeUrl,
  isListSetting,
  isMultilineSetting,
  type FieldValue,
} from "./settings-registry-utils";

/** Everything a row needs to know about one key, resolved by the manager. */
export interface SettingFieldState {
  value: FieldValue;
  isOverridden: boolean;
  isPending: boolean;
  isResetting: boolean;
  /** For a `secret` setting: whether one is stored. The value never reaches the browser. */
  secretIsSet: boolean;
}

export type SettingStateLookup = (key: SettingKey) => SettingFieldState;
export type SettingChangeHandler = (key: SettingKey, value: FieldValue) => void;
/** Several keys when one row edits several (a rate limit and its window). */
export type SettingResetHandler = (keys: SettingKey[]) => void;

export const SETTING_INPUT_CLASS =
  "h-9 bg-background/50 border-border/40 focus:border-primary/50";

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
    <div className="w-full">
      {items.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-1.5">
          {items.map((item, i) => (
            <span
              key={`${item}-${i}`}
              className="inline-flex items-center gap-1 rounded-full border border-primary/20 bg-primary/10 py-0.5 pl-2 pr-1 text-xs text-primary"
            >
              {item}
              <button
                type="button"
                onClick={() => removeAt(i)}
                // a11y (target size): the mark stays 10px, the box around it
                // is 24px so a dense wrapped row of chips stays tappable.
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
        placeholder="Add a keyword and press Enter"
        aria-label={ariaLabel}
        className={SETTING_INPUT_CLASS}
      />
    </div>
  );
}

/**
 * The reset control's column. It is always 36px wide, whether or not there is
 * anything to reset, so every control on a tab ends at the same x. It used to
 * appear only on a customised row, and the input beside it moved 44px left to
 * make room, which turned a column of number boxes into a zigzag.
 */
export function ResetSlot({
  show,
  busy,
  label,
  onReset,
}: {
  show: boolean;
  busy: boolean;
  label: string;
  onReset: () => void;
}) {
  return (
    <div className="h-9 w-9 shrink-0">
      {show && (
        <Button
          variant="ghost"
          size="sm"
          className="h-9 w-9 p-0 text-muted-foreground hover:text-foreground"
          onClick={onReset}
          disabled={busy}
          aria-label={label}
          title="Reset to default"
        >
          {busy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
          )}
        </Button>
      )}
    </div>
  );
}

/**
 * One row's frame: the description on the left, the control in a fixed-width
 * column on the right from lg up, stacked below that.
 *
 * The old row put help text in a 52ch column and floated the control to the
 * far edge of the card with nothing in between, so on a wide screen a label
 * and its input were half a page apart, and every input sat at a different
 * height depending on how long its help ran.
 */
export function SettingRowShell({
  pending,
  heading,
  description,
  control,
  reset,
}: {
  pending: boolean;
  heading: ReactNode;
  description: ReactNode;
  control: ReactNode;
  reset: ReactNode;
}) {
  return (
    <div
      // An unsaved edit carries a rail and a tint on the whole row, so it is
      // findable on a long tab without reading every badge.
      className={cn(
        "relative grid gap-x-8 gap-y-3 px-4 py-4 sm:px-5 lg:grid-cols-[minmax(0,1fr)_18rem] xl:grid-cols-[minmax(0,1fr)_22rem]",
        pending &&
          "bg-primary/5 before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-primary",
      )}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {heading}
        </div>
        {description}
      </div>
      <div className="flex min-w-0 items-start gap-2">
        <div className="flex min-h-9 min-w-0 flex-1 items-center lg:justify-end">
          {control}
        </div>
        {reset}
      </div>
    </div>
  );
}

export function SettingStatePill({
  pending,
  overridden,
  ignored = false,
}: {
  pending: boolean;
  overridden: boolean;
  /** A saved row for a compiled value: stored, and read by nothing. */
  ignored?: boolean;
}) {
  if (pending) return <StatusPill tone="info">Unsaved</StatusPill>;
  if (overridden && ignored) {
    return <StatusPill tone="warn">Saved value ignored</StatusPill>;
  }
  if (overridden) return <StatusPill tone="neutral">Customized</StatusPill>;
  return null;
}

export function SettingKeyName({ children }: { children: ReactNode }) {
  return (
    <p className="mt-1.5 break-all font-mono text-[11px] leading-4 text-muted-foreground/70">
      {children}
    </p>
  );
}

export function SettingField({
  fieldKey,
  state,
  onChange,
  onResetRequest,
}: {
  fieldKey: SettingKey;
  state: SettingFieldState;
  onChange: SettingChangeHandler;
  onResetRequest: SettingResetHandler;
}) {
  const def = SETTINGS_REGISTRY[fieldKey] as SettingDefinition;
  const { value, isOverridden, isPending, isResetting, secretIsSet } = state;
  const id = `setting-${fieldKey}`;
  const readOnly = !isWritableSetting(fieldKey);
  const stringValue = typeof value === "boolean" ? "" : String(value);
  const formatHint =
    readOnly || def.secret
      ? null
      : def.type === "email" && !looksLikeEmail(stringValue)
        ? "Doesn't look like an email address."
        : def.type === "url" && !looksLikeUrl(stringValue)
          ? "Doesn't look like a URL."
          : null;
  const source = readOnly ? compiledSourceFor(fieldKey) : null;

  let control: ReactNode;
  if (readOnly) {
    // Compiled into the app. An input here would save a row nothing reads,
    // so this shows the value the running app actually uses.
    const shown = formatFieldValue(def.default);
    control = (
      <output
        id={id}
        className="block w-full rounded-md border border-dashed border-border/60 bg-muted/20 px-3 py-2 font-mono text-xs leading-5 text-foreground wrap-break-word"
      >
        {shown === "" ? (
          <span className="font-sans text-muted-foreground">Empty</span>
        ) : (
          shown
        )}
      </output>
    );
  } else if (def.secret) {
    // Write-only. The admin API reports whether a credential is stored and
    // never what it is, so an empty box means "keep what is there".
    control = (
      <Input
        id={id}
        type="password"
        autoComplete="new-password"
        spellCheck={false}
        value={isPending ? stringValue : ""}
        onChange={(e) => onChange(fieldKey, e.target.value)}
        placeholder={secretIsSet ? "Stored. Type to replace it" : "Not set"}
        className={cn(SETTING_INPUT_CLASS, "w-full")}
      />
    );
  } else if (def.type === "bool") {
    control = (
      <Switch
        id={id}
        checked={Boolean(value)}
        onCheckedChange={(checked) => onChange(fieldKey, checked)}
      />
    );
  } else if (def.type === "int" || def.type === "float") {
    control = (
      <Input
        id={id}
        type="number"
        inputMode={def.type === "float" ? "decimal" : "numeric"}
        min={def.min}
        max={def.max}
        step={def.type === "float" ? "any" : 1}
        value={stringValue}
        onChange={(e) => onChange(fieldKey, e.target.value)}
        className={cn(SETTING_INPUT_CLASS, "w-36 tabular-nums")}
      />
    );
  } else if (def.type === "enum") {
    control = (
      <Select value={stringValue} onValueChange={(v) => onChange(fieldKey, v)}>
        <SelectTrigger id={id} className={cn(SETTING_INPUT_CLASS, "w-full")}>
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
    );
  } else if (isListSetting(fieldKey)) {
    control = (
      <ListValueEditor
        id={id}
        value={stringValue}
        onChange={(v) => onChange(fieldKey, v)}
        ariaLabel={def.label}
      />
    );
  } else if (isMultilineSetting(fieldKey)) {
    control = (
      <Textarea
        id={id}
        value={stringValue}
        onChange={(e) => onChange(fieldKey, e.target.value)}
        rows={3}
        maxLength={def.max}
        className="w-full resize-y border-border/40 bg-background/50 focus:border-primary/50"
      />
    );
  } else {
    control = (
      <Input
        id={id}
        type={
          def.type === "email" ? "email" : def.type === "url" ? "url" : "text"
        }
        value={stringValue}
        onChange={(e) => onChange(fieldKey, e.target.value)}
        className={cn(SETTING_INPUT_CLASS, "w-full")}
      />
    );
  }

  return (
    <SettingRowShell
      pending={isPending}
      heading={
        <>
          <label htmlFor={id} className="text-sm font-medium text-foreground">
            {def.label}
          </label>
          <SettingStatePill
            pending={isPending}
            overridden={isOverridden}
            ignored={readOnly}
          />
        </>
      }
      description={
        <>
          <p className="mt-1 max-w-prose text-xs leading-relaxed text-muted-foreground">
            {def.help}
          </p>
          {formatHint && (
            <p className="mt-1 text-xs text-[hsl(var(--warning))]">
              {formatHint}
            </p>
          )}
          {source && (
            // The box shows the shipped constant. When an env override exists
            // the running app may be using that instead, and the browser has
            // no way to know what a server was built with, so it says so
            // rather than presenting the default as the live value.
            <p className="mt-1.5 max-w-prose text-xs leading-relaxed text-muted-foreground">
              Compiled from{" "}
              <code className="font-mono text-foreground">
                {source.constant}
              </code>
              {source.env && (
                <>
                  , or{" "}
                  <code className="font-mono text-foreground">
                    {source.env}
                  </code>{" "}
                  if set at build time
                </>
              )}
              . Change it in lib/config/config-values.ts and redeploy.
            </p>
          )}
          <SettingKeyName>{fieldKey}</SettingKeyName>
        </>
      }
      control={control}
      reset={
        <ResetSlot
          show={isOverridden}
          busy={isResetting}
          label={
            readOnly
              ? `Delete the ignored saved value for ${def.label}`
              : `Reset ${def.label} to default`
          }
          onReset={() => onResetRequest([fieldKey])}
        />
      }
    />
  );
}
