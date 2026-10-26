"use client";

import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ListChecks, Trash2 } from "lucide-react";
import {
  AdminPanelHeader,
  DataTableSkeleton,
  EmptyState,
  SkeletonRegion,
  TableScrollArea,
} from "@/components/admin/shared";
import { formatDay } from "@/components/admin/utils";
import { useConfirm } from "@/components/shared/use-confirm";
import {
  describeRuleMatch,
  describeRuleThreshold,
  removePromotedRule,
  type PromotedRuleEntry,
} from "@/components/admin/features/engine-feedback-utils";

/**
 * Admin > Engine Feedback > Promoted rules: the auto-tag rules an admin has
 * saved from an AI tag, and the way to take one back out. It is the other half
 * of the AI Tag Candidates panel next to it (that one creates rules, this one
 * shows what is in effect), kept in its own file because the manager that owns
 * the data is already past 1,700 lines.
 *
 * Removing is a destructive change to what every future scan of every user is
 * labelled with, so it goes through useConfirm. The DELETE itself is
 * removePromotedRule in engine-feedback-utils.ts.
 */
export function PromotedRulesPanel({
  rules,
  loading,
  onRemoved,
}: {
  rules: PromotedRuleEntry[];
  loading: boolean;
  /** Called once the server has removed the rule; the parent toasts and re-reads. */
  onRemoved: (rule: PromotedRuleEntry) => void;
}) {
  const { confirm, confirmDialog } = useConfirm();

  /**
   * Throws on failure rather than toasting: it runs as a confirm dialog's
   * onConfirm, and the dialog stays open showing whatever a rejected
   * onConfirm throws. The parent's re-read is not awaited here, so the dialog
   * closes when the rule is gone and not when the page's lists have reloaded.
   */
  const removeRule = async (rule: PromotedRuleEntry) => {
    await removePromotedRule(rule.id);
    onRemoved(rule);
  };

  const askToRemoveRule = (rule: PromotedRuleEntry) =>
    confirm({
      title: `Remove the "${rule.tag}" rule?`,
      description: (
        <>
          New scans stop getting this tag. Scans that already have it keep it.
          If enough AI-tagged scans still back it, the tag goes back to AI Tag
          Candidates, where it can be promoted again with different fields.
        </>
      ),
      confirmLabel: "Remove rule",
      danger: true,
      onConfirm: () => removeRule(rule),
    });

  return (
    <>
      {/* Promoted rules */}
      <div className="overflow-hidden rounded-xl border border-border/50 bg-card/50">
        <AdminPanelHeader
          icon={ListChecks}
          title="Promoted rules"
          subtitle="Rules saved from an AI tag. Each one tags every new scan whose findings match, for every user. Removing a rule stops that; scans that already have the tag keep it."
        />
        <div>
          {loading ? (
            <SkeletonRegion label="Loading promoted rules">
              <DataTableSkeleton rows={2} />
            </SkeletonRegion>
          ) : rules.length === 0 ? (
            <EmptyState
              icon={ListChecks}
              title="No promoted rules"
              description="Nothing has been promoted from an AI tag yet, so only the built-in rules tag scans."
            />
          ) : (
            <>
              <div className="hidden md:block">
                <TableScrollArea maxHeight="40vh">
                  <Table className="min-w-[640px]">
                    <TableHeader className="sticky top-0 z-20 bg-muted">
                      <TableRow className="border-y border-border/50 hover:bg-transparent">
                        <TableHead className="px-5 h-10 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                          Tag
                        </TableHead>
                        <TableHead className="px-4 h-10 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                          Matches
                        </TableHead>
                        <TableHead className="px-4 h-10 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                          Threshold
                        </TableHead>
                        <TableHead className="px-4 h-10 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                          Promoted
                        </TableHead>
                        <TableHead className="px-5 h-10 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                          Action
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rules.map((rule) => (
                        <TableRow key={rule.id} className="border-border/40">
                          <TableCell className="px-5 py-3 text-sm font-medium wrap-break-word">
                            {rule.tag}
                          </TableCell>
                          <TableCell className="px-4 py-3 text-xs text-muted-foreground wrap-break-word">
                            {describeRuleMatch(rule)}
                          </TableCell>
                          <TableCell className="px-4 py-3 text-xs text-muted-foreground">
                            {describeRuleThreshold(rule)}
                          </TableCell>
                          <TableCell className="px-4 py-3 text-xs text-muted-foreground">
                            <span className="block text-foreground">
                              {rule.createdBy ?? "Account deleted"}
                            </span>
                            {formatDay(rule.createdAt)}
                          </TableCell>
                          <TableCell className="px-5 py-3 text-right">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8 gap-1.5 border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
                              aria-label={`Remove the ${rule.tag} rule`}
                              onClick={() => askToRemoveRule(rule)}
                            >
                              <Trash2
                                className="h-3.5 w-3.5"
                                aria-hidden="true"
                              />
                              Remove
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableScrollArea>
              </div>

              {/* Mobile cards */}
              <div className="md:hidden divide-y divide-border/40">
                {rules.map((rule) => (
                  <div key={rule.id} className="px-4 py-3.5">
                    <p className="text-sm font-medium wrap-break-word">
                      {rule.tag}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground wrap-break-word">
                      {describeRuleMatch(rule)}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {describeRuleThreshold(rule)}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {rule.createdBy ?? "Account deleted"},{" "}
                      {formatDay(rule.createdAt)}
                    </p>
                    <div className="mt-3 flex justify-end">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 gap-1.5 border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
                        aria-label={`Remove the ${rule.tag} rule`}
                        onClick={() => askToRemoveRule(rule)}
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        Remove
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
      {confirmDialog}
    </>
  );
}
