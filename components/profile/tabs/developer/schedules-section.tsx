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
  Users,
} from "lucide-react";
import Link from "next/link";
import { ROUTES, BILLING_ENABLED } from "@/lib/config/client-constants";
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
import { TeamAssignSelect } from "@/components/shared/team-assign-select";
import type { AssignableTeamsResult } from "@/lib/hooks/use-assignable-teams";

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
  /** Session user's plan id, for the hourly/6-hourly upgrade gate. null
   *  while /auth/me is still in flight: nothing is locked on a plan nobody
   *  knows yet, since the guess was "free" and that told a Pro Supporter
   *  their hourly scans needed an upgrade they had already paid for. */
  userPlan: string | null;
  /** Pause/resume a schedule in place. Not routed through the destructive
   *  confirm dialog: flipping it back is one click either way. */
  onToggleSchedule: (id: number, active: boolean) => void;
  /** Id of the schedule currently mid-toggle, for a per-row spinner. */
  togglingScheduleId: number | null;
  /** Session user id, or null while /auth/me is in flight. The list also
   *  carries schedules a teammate shared, and PATCH refuses a team change
   *  from anyone but the schedule's owner. */
  currentUserId: number | null;
  /** The caller's teams, split into the ones they may assign to and the ones
   *  they merely belong to. Nothing team-shaped is drawn until it is loaded,
   *  so the picker does not appear a beat after the row it belongs to. */
  teams: AssignableTeamsResult;
  assigningTeamScheduleId: number | null;
  onAssignScheduleTeam: (id: number, teamId: number | null) => void;
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
  currentUserId,
  teams,
  assigningTeamScheduleId,
  onAssignScheduleTeam,
}: SchedulesSectionProps) {
  const teamLabel = (teamId: number) =>
    teams.all.find((team) => team.id === teamId)?.name ?? "A team";
  const freqDef = FREQUENCIES[scheduleFreq as ScheduleFrequency];
  const requiredPlan = freqDef?.minPlan;
  // Self-hosted with billing off: every frequency is unlocked, same as
  // every other plan-gated feature in this codebase (see
  // userMeetsScheduleFrequency in lib/billing/plan-limits.ts).
  const isLocked =
    BILLING_ENABLED &&
    !!requiredPlan &&
    userPlan !== null &&
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
          {teams.assignable.length > 0 &&
            " Share one with a team and every co-member can see it and pause it."}
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
                      userPlan !== null &&
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
                    // The controls take their own line below sm, same reasoning
                    // as the webhook and domain rows: the team picker plus
                    // pause and delete is more than a 320px screen can hold
                    // beside a full URL.
                    className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 hover:bg-muted/30 transition-colors"
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
                            className="text-[10px] px-1.5 py-0 uppercase font-semibold border-[hsl(var(--warning))]/40 text-[hsl(var(--warning))]"
                          >
                            Paused
                          </Badge>
                        )}
                        {sch.team_id != null && (
                          <Badge
                            variant="outline"
                            className="gap-1 border-primary/20 bg-primary/10 px-1.5 py-0 text-[10px] font-semibold uppercase text-primary"
                          >
                            <Users className="h-2.5 w-2.5" aria-hidden="true" />
                            {teamLabel(sch.team_id)}
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
                    <div className="flex w-full flex-wrap items-center gap-1 sm:w-auto sm:shrink-0">
                      {/* Owner only: PATCH /api/v3/schedules refuses a team
                          change from a co-member, even one whose role lets
                          them pause and delete the same schedule. */}
                      {teams.loaded &&
                        currentUserId !== null &&
                        sch.user_id === currentUserId && (
                          <TeamAssignSelect
                            className="mr-1"
                            teams={teams.assignable}
                            value={sch.team_id ?? null}
                            currentTeamName={
                              sch.team_id != null
                                ? teamLabel(sch.team_id)
                                : null
                            }
                            busy={assigningTeamScheduleId === sch.id}
                            label={`Team for the scheduled scan of ${sch.url}`}
                            onChange={(teamId) =>
                              onAssignScheduleTeam(sch.id, teamId)
                            }
                          />
                        )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-11 w-11 sm:h-7 sm:w-7 text-muted-foreground hover:text-foreground shrink-0"
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
                        className="h-11 w-11 sm:h-7 sm:w-7 text-destructive hover:text-destructive hover:bg-destructive/10 shrink-0"
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
