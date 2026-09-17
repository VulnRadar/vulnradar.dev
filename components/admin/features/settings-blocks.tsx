"use client";

import { useId } from "react";
import { Input } from "@/components/ui/input";
import { PLANS } from "@/lib/billing/catalog";
import { cn } from "@/lib/ui/utils";
import {
  SETTINGS_REGISTRY,
  type SettingDefinition,
  type SettingKey,
} from "@/lib/config/registry";
import {
  ResetSlot,
  SettingKeyName,
  SettingRowShell,
  SettingStatePill,
  SETTING_INPUT_CLASS,
  type SettingChangeHandler,
  type SettingResetHandler,
  type SettingStateLookup,
} from "./settings-field";
import {
  PLAN_KEY_TOKENS,
  type PlanKeyToken,
  type PlanMetric,
} from "./settings-registry-utils";

/**
 * A rate limit and its window as one row: "[10] per [15] minutes".
 *
 * They were two rows each, 41 on the tab, and "Login window (minutes)" on its
 * own line said nothing that "Login attempts per window" did not need to be
 * read beside.
 */
export function SettingRateLimitRow({
  limitKey,
  windowKey,
  stateOf,
  onChange,
  onResetRequest,
}: {
  limitKey: SettingKey;
  windowKey: SettingKey;
  stateOf: SettingStateLookup;
  onChange: SettingChangeHandler;
  onResetRequest: SettingResetHandler;
}) {
  const limitDef = SETTINGS_REGISTRY[limitKey] as SettingDefinition;
  const windowDef = SETTINGS_REGISTRY[windowKey] as SettingDefinition;
  const limit = stateOf(limitKey);
  const windowState = stateOf(windowKey);
  const pending = limit.isPending || windowState.isPending;
  const overridden = [limitKey, windowKey].filter(
    (k) => stateOf(k).isOverridden,
  );
  const limitId = `setting-${limitKey}`;
  const windowId = `setting-${windowKey}`;
  const title = limitDef.label.replace(/ per window$/, "");

  return (
    <SettingRowShell
      pending={pending}
      heading={
        <>
          <label
            htmlFor={limitId}
            className="text-sm font-medium text-foreground"
          >
            {title}
          </label>
          <SettingStatePill
            pending={pending}
            overridden={overridden.length > 0}
          />
        </>
      }
      description={
        <>
          <p className="mt-1 max-w-prose text-xs leading-relaxed text-muted-foreground">
            {limitDef.help}
          </p>
          <SettingKeyName>
            {limitKey}, {windowKey}
          </SettingKeyName>
        </>
      }
      control={
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Input
            id={limitId}
            type="number"
            inputMode="numeric"
            min={limitDef.min}
            max={limitDef.max}
            step={1}
            value={String(limit.value)}
            onChange={(e) => onChange(limitKey, e.target.value)}
            className={cn(
              SETTING_INPUT_CLASS,
              "w-28 tabular-nums",
              limit.isPending && "border-primary/60",
            )}
          />
          <span aria-hidden="true">per</span>
          <Input
            id={windowId}
            type="number"
            inputMode="numeric"
            min={windowDef.min}
            max={windowDef.max}
            step={1}
            value={String(windowState.value)}
            onChange={(e) => onChange(windowKey, e.target.value)}
            aria-label={windowDef.label}
            className={cn(
              SETTING_INPUT_CLASS,
              "w-24 tabular-nums",
              windowState.isPending && "border-primary/60",
            )}
          />
          <span aria-hidden="true">min</span>
        </div>
      }
      reset={
        <ResetSlot
          show={overridden.length > 0}
          busy={limit.isResetting || windowState.isResetting}
          label={`Reset ${title} to default`}
          onReset={() => onResetRequest(overridden)}
        />
      }
    />
  );
}

const PLAN_NAMES: Record<PlanKeyToken, string> = Object.fromEntries(
  PLAN_KEY_TOKENS.map((token) => [
    token,
    PLANS.find((p) => p.id === token.toLowerCase())?.name ?? token,
  ]),
) as Record<PlanKeyToken, string>;

/**
 * Per-plan limits as a matrix: a row per limit, a column per plan.
 *
 * Sixty rows of "Free plan daily scans", "Core supporter daily scans", "Pro
 * supporter daily scans" hid the one thing an operator comparing tiers wants,
 * which is the four numbers side by side. Below md there is no room for five
 * columns, so each limit becomes a two-by-two grid with the plan named above
 * each box; `md:contents` lets the same cells join the parent grid from md up.
 */
export function SettingsPlanMatrix({
  metrics,
  stateOf,
  onChange,
  onResetRequest,
}: {
  metrics: PlanMetric[];
  stateOf: SettingStateLookup;
  onChange: SettingChangeHandler;
  onResetRequest: SettingResetHandler;
}) {
  return (
    <div className="px-4 py-2 sm:px-5">
      <div
        aria-hidden="true"
        className="hidden gap-x-3 border-b border-border/40 pb-2 pt-2 text-xs font-medium text-muted-foreground md:grid md:grid-cols-[minmax(0,1fr)_repeat(4,7.5rem)]"
      >
        <span>Limit</span>
        {PLAN_KEY_TOKENS.map((token) => (
          <span key={token} className="pl-1">
            {PLAN_NAMES[token]}
          </span>
        ))}
      </div>
      <div className="divide-y divide-border/40">
        {metrics.map((metric) => (
          <PlanMetricRow
            key={metric.metric}
            metric={metric}
            stateOf={stateOf}
            onChange={onChange}
            onResetRequest={onResetRequest}
          />
        ))}
      </div>
    </div>
  );
}

function PlanMetricRow({
  metric,
  stateOf,
  onChange,
  onResetRequest,
}: {
  metric: PlanMetric;
  stateOf: SettingStateLookup;
  onChange: SettingChangeHandler;
  onResetRequest: SettingResetHandler;
}) {
  const keys = PLAN_KEY_TOKENS.map((token) => metric.keys[token]);
  const pending = keys.some((k) => stateOf(k).isPending);
  const overridden = keys.some((k) => stateOf(k).isOverridden);

  return (
    <div
      className={cn(
        "relative grid gap-3 py-3 md:grid-cols-[minmax(0,1fr)_repeat(4,7.5rem)] md:items-start md:gap-x-3",
        pending &&
          "before:absolute before:-left-4 before:inset-y-0 before:w-0.5 before:bg-primary sm:before:-left-5",
      )}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <p className="text-sm font-medium text-foreground">{metric.label}</p>
          <SettingStatePill pending={pending} overridden={overridden} />
        </div>
        <p className="mt-1 max-w-prose text-xs leading-relaxed text-muted-foreground">
          {metric.help}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2 md:contents">
        {PLAN_KEY_TOKENS.map((token) => (
          <PlanCell
            key={token}
            settingKey={metric.keys[token]}
            planName={PLAN_NAMES[token]}
            metricLabel={metric.label}
            stateOf={stateOf}
            onChange={onChange}
            onResetRequest={onResetRequest}
          />
        ))}
      </div>
    </div>
  );
}

function PlanCell({
  settingKey,
  planName,
  metricLabel,
  stateOf,
  onChange,
  onResetRequest,
}: {
  settingKey: SettingKey;
  planName: string;
  metricLabel: string;
  stateOf: SettingStateLookup;
  onChange: SettingChangeHandler;
  onResetRequest: SettingResetHandler;
}) {
  const def = SETTINGS_REGISTRY[settingKey] as SettingDefinition;
  const state = stateOf(settingKey);
  const helpId = useId();
  const id = `setting-${settingKey}`;
  const numeric = Number(state.value);

  return (
    <div className="min-w-0">
      <label
        htmlFor={id}
        className="mb-1 block text-xs text-muted-foreground md:sr-only"
      >
        {planName}
        <span className="sr-only">: {metricLabel}</span>
      </label>
      <div className="relative">
        <Input
          id={id}
          type="number"
          inputMode="numeric"
          min={def.min}
          max={def.max}
          step={1}
          value={String(state.value)}
          onChange={(e) => onChange(settingKey, e.target.value)}
          aria-describedby={helpId}
          className={cn(
            SETTING_INPUT_CLASS,
            // No spin buttons: nobody steps a limit of 80000 by one, and on
            // hover they sat under the reset control.
            "w-full tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
            state.isOverridden && "pr-9",
            state.isPending && "border-primary/60",
          )}
        />
        {state.isOverridden && (
          <div className="absolute right-0 top-0">
            <ResetSlot
              show
              busy={state.isResetting}
              label={`Reset ${planName} ${metricLabel} to default`}
              onReset={() => onResetRequest([settingKey])}
            />
          </div>
        )}
      </div>
      {/* The plan's own wording, which sometimes carries a note the shared
          line above generalises away. */}
      <span id={helpId} className="sr-only">
        {def.help}
      </span>
      {numeric === -1 && (
        <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
          Unlimited
        </p>
      )}
    </div>
  );
}
