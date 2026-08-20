"use client";

import { cn } from "@/lib/ui/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Plus,
  Trash2,
  CalendarClock,
  Loader2,
  Lock,
  Pause,
  Play,
} from "lucide-react";
import Link from "next/link";
import { ROUTES, BILLING_ENABLED } from "@/lib/config/constants";
import { hasFeatureAccess } from "@/components/modals/premium-upgrade-modal";
import { getPlanById } from "@/lib/billing/catalog";
import {
  FREQUENCIES,
  SCHEDULE_FREQUENCIES,
  type ScheduleFrequency,
} from "@/lib/scanner/schedule-timing";
import { localHourLabel } from "./schedule-time-utils";
import type { ScheduleItem } from "@/components/profile/types";
import type { ConfirmAction } from "./types";

const DAY_LABELS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

interface SchedulesSectionProps {
  schedules: ScheduleItem[];
  scheduleUrl: string;
  onScheduleUrlChange: (value: string) => void;
  scheduleFreq: string;
  onScheduleFreqChange: (value: string) => void;
  /** Local hour (0-23) the new schedule should run at. Ignored for "hourly"
   *  (which fires every hour, so a preferred hour has no effect). */
  scheduleHourLocal: number;
  onScheduleHourLocalChange: (value: number) => void;
  /** Local day of week (0-6, Sunday=0). Only used when frequency is "weekly". */
  scheduleDayOfWeekLocal: number;
  onScheduleDayOfWeekLocalChange: (value: number) => void;
  /** Local day of month (1-28). Only used when frequency is "monthly". */
  scheduleDayOfMonthLocal: number;
  onScheduleDayOfMonthLocalChange: (value: number) => void;
  addingSchedule: boolean;
  onAddSchedule: () => void;
  onRequestConfirm: (action: ConfirmAction) => void;
  scheduleTimestamp: (
    sch: ScheduleItem,
    which: "next_run" | "last_run",
  ) => string | null;
  /** Session user's plan id, for the hourly/6-hourly upgrade gate. */
  userPlan: string;
  /** Pause/resume a schedule in place. Not routed through the destructive
   *  confirm dialog: flipping it back is one click either way. */
  onToggleSchedule: (id: number, active: boolean) => void;
  /** Id of the schedule currently mid-toggle, for a per-row spinner. */
  togglingScheduleId: number | null;
}

function formatScheduleTime(iso: string | null): string {
  if (!iso) return "Never";
  return new Date(iso).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/**
 * Scheduled Scans sub-section of the Developer tab. Purely presentational:
 * the shell owns the form state, the API calls, and the shared destructive
 * confirmation dialog. Frequency + time-of-day pickers are UTC-agnostic
 * from the caller's perspective -- everything here is local-time, the
 * shell converts to UTC once at submit (see schedule-time-utils.ts).
 */
export function SchedulesSection({
  schedules,
  scheduleUrl,
  onScheduleUrlChange,
  scheduleFreq,
  onScheduleFreqChange,
  scheduleHourLocal,
  onScheduleHourLocalChange,
  scheduleDayOfWeekLocal,
  onScheduleDayOfWeekLocalChange,
  scheduleDayOfMonthLocal,
  onScheduleDayOfMonthLocalChange,
  addingSchedule,
  onAddSchedule,
  onRequestConfirm,
  scheduleTimestamp,
  userPlan,
  onToggleSchedule,
  togglingScheduleId,
}: SchedulesSectionProps) {
  const freqDef = FREQUENCIES[scheduleFreq as ScheduleFrequency];
  const requiredPlan = freqDef?.minPlan;
  // Self-hosted with billing off: every frequency is unlocked, same as
  // every other plan-gated feature in this codebase (see
  // userMeetsScheduleFrequency in lib/billing/plan-limits.ts).
  const isLocked =
    BILLING_ENABLED &&
    !!requiredPlan &&
    !hasFeatureAccess(userPlan, requiredPlan);
  const requiredPlanName = requiredPlan
    ? (getPlanById(requiredPlan)?.name ?? requiredPlan)
    : null;

  const showHourPicker = scheduleFreq !== "hourly";
  const showDayOfWeekPicker = scheduleFreq === "weekly";
  const showDayOfMonthPicker = scheduleFreq === "monthly";

  return (
    <section className="flex flex-col gap-4">
      <div className="min-w-0">
        <h2 className="text-base font-semibold tracking-tight text-foreground">
          Recurring scans
        </h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          Re-scan a URL on a schedule and get told when something regresses.
        </p>
      </div>
      <Card className="border-border/50 bg-card/50">
        <CardContent className="pt-6 space-y-4">
          {/* Add schedule form */}
          <div className="flex flex-col gap-3 p-4 rounded-lg border border-border bg-secondary/30">
            <div className="flex flex-col sm:flex-row gap-2">
              <div className="flex-1 min-w-0">
                <Label htmlFor="schedule-url" className="sr-only">
                  URL to scan on a schedule
                </Label>
                <Input
                  id="schedule-url"
                  placeholder="https://example.com"
                  value={scheduleUrl}
                  onChange={(e) => onScheduleUrlChange(e.target.value)}
                  className="bg-card h-10 w-full"
                />
              </div>
              <div>
                <Label htmlFor="schedule-freq" className="sr-only">
                  How often to scan
                </Label>
                <select
                  id="schedule-freq"
                  value={scheduleFreq}
                  onChange={(e) => onScheduleFreqChange(e.target.value)}
                  className="h-10 w-full sm:w-auto px-3 rounded-md border border-border bg-card text-foreground text-base sm:text-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {SCHEDULE_FREQUENCIES.map((freq) => {
                    const def = FREQUENCIES[freq];
                    const locked =
                      BILLING_ENABLED &&
                      !!def.minPlan &&
                      !hasFeatureAccess(userPlan, def.minPlan);
                    return (
                      <option key={freq} value={freq} disabled={locked}>
                        {def.label}
                        {locked
                          ? ` (${getPlanById(def.minPlan!)?.name ?? def.minPlan})`
                          : ""}
                      </option>
                    );
                  })}
                </select>
              </div>
              <Button
                disabled={!scheduleUrl || addingSchedule || isLocked}
                onClick={onAddSchedule}
                className="shrink-0"
              >
                {addingSchedule ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
                <span className="ml-1.5">Add</span>
              </Button>
            </div>

            {/* Time-of-day controls: shown/hidden per frequency. Values are
                local-time; the shell converts to UTC at submit. */}
            {(showHourPicker ||
              showDayOfWeekPicker ||
              showDayOfMonthPicker) && (
              <div className="flex flex-wrap items-center gap-2">
                {showDayOfWeekPicker && (
                  <select
                    aria-label="Day of week"
                    value={scheduleDayOfWeekLocal}
                    onChange={(e) =>
                      onScheduleDayOfWeekLocalChange(Number(e.target.value))
                    }
                    className="h-9 px-2.5 rounded-md border border-border bg-card text-foreground text-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {DAY_LABELS.map((label, dow) => (
                      <option key={dow} value={dow}>
                        {label}
                      </option>
                    ))}
                  </select>
                )}
                {showDayOfMonthPicker && (
                  <select
                    aria-label="Day of month"
                    value={scheduleDayOfMonthLocal}
                    onChange={(e) =>
                      onScheduleDayOfMonthLocalChange(Number(e.target.value))
                    }
                    className="h-9 px-2.5 rounded-md border border-border bg-card text-foreground text-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {Array.from({ length: 28 }, (_, i) => i + 1).map((dom) => (
                      <option key={dom} value={dom}>
                        Day {dom}
                      </option>
                    ))}
                  </select>
                )}
                {showHourPicker && (
                  <select
                    aria-label="Time of day"
                    value={scheduleHourLocal}
                    onChange={(e) =>
                      onScheduleHourLocalChange(Number(e.target.value))
                    }
                    className="h-9 px-2.5 rounded-md border border-border bg-card text-foreground text-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {Array.from({ length: 24 }, (_, h) => h).map((h) => (
                      <option key={h} value={h}>
                        {localHourLabel(h)}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )}

            {isLocked && requiredPlanName && (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Lock className="h-3 w-3 shrink-0" aria-hidden="true" />
                {freqDef.label} scans need the {requiredPlanName} plan.{" "}
                <Link
                  href={ROUTES.PRICING}
                  className="text-primary hover:underline"
                >
                  Upgrade
                </Link>
              </p>
            )}
          </div>

          {/* Schedule list */}
          {schedules.length === 0 ? (
            <p className="text-sm text-muted-foreground py-2 max-w-prose leading-relaxed">
              No recurring scans yet. Add a URL above to have it re-scanned on a
              schedule, so a regression shows up without anyone remembering to
              check.
            </p>
          ) : (
            <div className="rounded-lg border border-border divide-y divide-border/60 overflow-hidden">
              {schedules.map((sch) => {
                const nextRun = scheduleTimestamp(sch, "next_run");
                const lastRun = scheduleTimestamp(sch, "last_run");
                const isPaused = sch.active === false;
                const isToggling = togglingScheduleId === sch.id;
                return (
                  <div
                    key={sch.id}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors"
                  >
                    <CalendarClock
                      className={cn(
                        "h-4 w-4 shrink-0",
                        isPaused ? "text-muted-foreground" : "text-primary",
                      )}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate font-mono">
                        {sch.url}
                      </p>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                        <Badge
                          variant="secondary"
                          className="text-[10px] px-1.5 py-0 uppercase font-semibold"
                        >
                          {FREQUENCIES[sch.frequency as ScheduleFrequency]
                            ?.label ?? sch.frequency}
                        </Badge>
                        {isPaused && (
                          <Badge
                            variant="outline"
                            className="text-[10px] px-1.5 py-0 uppercase font-semibold border-amber-500/40 text-amber-600 dark:text-amber-400"
                          >
                            Paused
                          </Badge>
                        )}
                        {nextRun && (
                          <span>Next: {formatScheduleTime(nextRun)}</span>
                        )}
                        {lastRun && (
                          <span>Last: {formatScheduleTime(lastRun)}</span>
                        )}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-foreground shrink-0"
                      disabled={isToggling}
                      onClick={() => onToggleSchedule(sch.id, !isPaused)}
                      aria-label={
                        isPaused
                          ? `Resume scheduled scan for ${sch.url}`
                          : `Pause scheduled scan for ${sch.url}`
                      }
                    >
                      {isToggling ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : isPaused ? (
                        <Play className="h-3.5 w-3.5" />
                      ) : (
                        <Pause className="h-3.5 w-3.5" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10 shrink-0"
                      onClick={() =>
                        onRequestConfirm({
                          kind: "delete-schedule",
                          id: sch.id,
                          label: sch.url,
                        })
                      }
                      aria-label={`Delete scheduled scan for ${sch.url}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                );
              })}
            </div>
          )}

          <div className="rounded-lg bg-muted/50 border border-border p-3">
            <p className="text-xs text-muted-foreground leading-relaxed">
              Scheduled scans run automatically at the configured frequency.
              Results are saved to your scan history and any active webhooks
              will be notified.
            </p>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
