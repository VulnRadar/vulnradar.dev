"use client";

/**
 * Start a broadcast from a written template instead of an empty textarea.
 *
 * The composer's content field is a textarea whose placeholder says "HTML tags
 * are supported", which is an accurate description of a blank page. Every
 * message this product sends automatically has a reviewed template behind it;
 * the ones a person writes had none, so the announcement that reaches every
 * registered account was whatever markup somebody typed that afternoon.
 *
 * These are the same blocks the real templates are built from, so what the
 * preview shows and what lands in the inbox are the message the rest of the
 * product would have sent.
 */

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Sparkles, Wand2, Loader2 } from "lucide-react";
import { cn } from "@/lib/ui/utils";
import { BILLING_ENABLED } from "@/lib/config/client-constants";
import {
  CAMPAIGN_TEMPLATES,
  campaignDefaults,
  releaseCampaignValues,
  type CampaignTemplate,
  type CampaignValues,
} from "@/lib/email/campaigns";
import { LeadingIcon } from "@/components/shared/leading-icon";

interface Props {
  /** Called with everything the composer needs, once the writer confirms. */
  onApply: (next: { title: string; content: string; category: string }) => void;
}

export function CampaignTemplatePicker({ onApply }: Props) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<CampaignTemplate | null>(null);
  const [values, setValues] = useState<CampaignValues>({});
  const [fillingFromChangelog, setFillingFromChangelog] = useState(false);

  // A deployment with billing off has no plans to promote, so offering the
  // offer template there is offering a message that cannot be written.
  const templates = useMemo(
    () => CAMPAIGN_TEMPLATES.filter((t) => BILLING_ENABLED || !t.billingOnly),
    [],
  );

  function choose(template: CampaignTemplate) {
    setSelected(template);
    setValues(campaignDefaults(template));
  }

  /**
   * Fill the release template from the newest changelog entry.
   *
   * The changelog entry is the considered version of what shipped, written
   * when the change was fresh; retyping it into a broadcast produces a worse
   * summary every time. Imported dynamically because lib/changelog/data.ts is
   * five thousand lines and this is the only thing in the admin panel that
   * wants it.
   */
  async function fillFromChangelog() {
    setFillingFromChangelog(true);
    try {
      const { CHANGELOG } = await import("@/lib/changelog/data");
      const latest = CHANGELOG[0];
      if (!latest) return;
      setValues(
        releaseCampaignValues({
          version: latest.version,
          title: latest.title,
          summary: latest.summary,
          changes: latest.changes.map((c) => ({
            label: c.label,
            category: c.category,
          })),
        }),
      );
    } finally {
      setFillingFromChangelog(false);
    }
  }

  function apply() {
    if (!selected) return;
    onApply({
      title: selected.subject(values),
      content: selected.body(values).trim(),
      category: selected.audience,
    });
    setOpen(false);
    setSelected(null);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setSelected(null);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-1.5">
          <LeadingIcon icon={Sparkles} size="sm" line="xs" />
          Start from a template
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {selected ? selected.name : "Start from a template"}
          </DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-4">
          {!selected && (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {templates.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => choose(t)}
                  className={cn(
                    "rounded-lg border border-border/50 bg-background/50 p-4 text-left",
                    "transition-colors hover:border-primary/40 hover:bg-muted/40",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  )}
                >
                  <p className="text-sm font-semibold text-foreground">
                    {t.name}
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {t.description}
                  </p>
                  <p className="mt-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">
                    {t.audience === "email_product_updates"
                      ? "Product updates"
                      : "Tips & guides"}
                  </p>
                </button>
              ))}
            </div>
          )}

          {selected && (
            <>
              {selected.id === "release-notes" && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1.5"
                  onClick={fillFromChangelog}
                  disabled={fillingFromChangelog}
                >
                  {fillingFromChangelog ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <LeadingIcon icon={Wand2} size="sm" line="xs" />
                  )}
                  Fill from the newest changelog entry
                </Button>
              )}

              {selected.fields.map((field) => (
                <div key={field.key}>
                  <label
                    htmlFor={`campaign-${field.key}`}
                    className="mb-2 block text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                  >
                    {field.label}
                    {field.optional && (
                      <span className="ml-1.5 normal-case tracking-normal text-muted-foreground/60">
                        optional
                      </span>
                    )}
                  </label>
                  {field.multiline ? (
                    <Textarea
                      id={`campaign-${field.key}`}
                      value={values[field.key] ?? ""}
                      placeholder={field.placeholder}
                      onChange={(e) =>
                        setValues((v) => ({
                          ...v,
                          [field.key]: e.target.value,
                        }))
                      }
                      className="min-h-24 resize-none border-border/40 bg-background/50"
                    />
                  ) : (
                    <Input
                      id={`campaign-${field.key}`}
                      value={values[field.key] ?? ""}
                      placeholder={field.placeholder}
                      onChange={(e) =>
                        setValues((v) => ({
                          ...v,
                          [field.key]: e.target.value,
                        }))
                      }
                      className="h-10 border-border/40 bg-background/50"
                    />
                  )}
                  {field.hint && (
                    <p className="mt-1.5 text-xs text-muted-foreground">
                      {field.hint}
                    </p>
                  )}
                </div>
              ))}

              <div className="flex flex-wrap gap-2 pt-1">
                <Button size="sm" className="h-8" onClick={apply}>
                  Use this
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8"
                  onClick={() => setSelected(null)}
                >
                  Back to templates
                </Button>
              </div>
              {/* The composer's own preview is the one that matters, and it
                  renders the real shell. Saying so is cheaper than building a
                  second preview here that could drift from it. */}
              <p className="text-xs text-muted-foreground">
                This fills the subject, the content and the preference filter.
                Edit them in the composer, then use Preview to see the message
                exactly as it will arrive.
              </p>
            </>
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
