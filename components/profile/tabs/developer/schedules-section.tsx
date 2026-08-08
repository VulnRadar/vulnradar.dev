"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, CalendarClock, Loader2 } from "lucide-react";
import type { ScheduleItem } from "@/components/profile/types";
import type { ConfirmAction } from "./types";

interface SchedulesSectionProps {
  schedules: ScheduleItem[];
  scheduleUrl: string;
  onScheduleUrlChange: (value: string) => void;
  scheduleFreq: string;
  onScheduleFreqChange: (value: string) => void;
  addingSchedule: boolean;
  onAddSchedule: () => void;
  onRequestConfirm: (action: ConfirmAction) => void;
  scheduleTimestamp: (
    sch: ScheduleItem,
    which: "next_run" | "last_run",
  ) => string | null;
}

/**
 * Scheduled Scans sub-section of the Developer tab. Purely presentational:
 * the shell owns the form state, the API calls, and the shared destructive
 * confirmation dialog.
 */
export function SchedulesSection({
  schedules,
  scheduleUrl,
  onScheduleUrlChange,
  scheduleFreq,
  onScheduleFreqChange,
  addingSchedule,
  onAddSchedule,
  onRequestConfirm,
  scheduleTimestamp,
}: SchedulesSectionProps) {
  return (
    <section className="flex flex-col gap-4">
      <div className="min-w-0">
        <h2 className="text-base font-semibold tracking-tight text-foreground">
          Recurring scans
        </h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          Re-scan a URL on a schedule and get told when something regresses.
          Needs an active API key.
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
                  className="h-10 w-full sm:w-auto px-3 rounded-md border border-border bg-card text-foreground text-base sm:text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                >
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                </select>
              </div>
              <Button
                disabled={!scheduleUrl || addingSchedule}
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
                return (
                  <div
                    key={sch.id}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors"
                  >
                    <CalendarClock className="h-4 w-4 text-primary shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate font-mono">
                        {sch.url}
                      </p>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Badge
                          variant="secondary"
                          className="text-[10px] px-1.5 py-0 uppercase font-semibold"
                        >
                          {sch.frequency}
                        </Badge>
                        {nextRun && (
                          <span>
                            Next:{" "}
                            {new Date(nextRun).toLocaleDateString("en-US", {
                              month: "short",
                              day: "numeric",
                            })}
                          </span>
                        )}
                        {lastRun && (
                          <span>
                            Last:{" "}
                            {new Date(lastRun).toLocaleDateString("en-US", {
                              month: "short",
                              day: "numeric",
                            })}
                          </span>
                        )}
                      </div>
                    </div>
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
              will be notified. Schedules require an active API key.
            </p>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
