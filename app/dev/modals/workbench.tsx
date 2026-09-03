"use client";

import { useState } from "react";
import { AlertTriangle, Loader2, Search, Shield } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ModalShell } from "@/components/ui/modal-shell";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { ShareModal } from "@/components/scanner/share-modal";
import { EmptyState } from "@/components/shared/empty-state";
import { InlineAlert } from "@/components/shared/inline-alert";
import { MODAL_INVENTORY, type InventoryEntry } from "./inventory";
import { cn } from "@/lib/ui/utils";

/**
 * The states worth checking. These are the five that have actually broken a
 * modal in this codebase: a list with nothing in it, a list still fetching, a
 * request that failed with nowhere to say so, prose long enough to need the
 * body to scroll, and enough rows to push the footer off a laptop screen.
 */
const STATES = [
  "default",
  "empty",
  "loading",
  "error",
  "long",
  "many",
] as const;
type State = (typeof STATES)[number];

const LOREM =
  "The scanner replays the same request the browser would, follows the redirect chain, and records every response header it gets back. Nothing is inferred from the URL alone.";

const ROWS = Array.from({ length: 60 }, (_, i) => ({
  id: `row-${i + 1}`,
  name: `acme/service-${String(i + 1).padStart(3, "0")}`,
  note: i % 3 === 0 ? "private" : "public",
}));

interface Specimen {
  id: string;
  /** What it is called in the app, or what it demonstrates. */
  name: string;
  group: string;
  /** Which grammar tier it uses, shown next to the name. */
  tier: "shell" | "compact" | "sheet" | "overlay";
  size: string;
  /** Where the real thing lives, so a finding here is one grep from a fix. */
  source: string;
  states: readonly State[];
  render: (state: State, close: () => void) => React.ReactNode;
}

/** Body content for whichever state a specimen is being shown in. */
function StateBody({ state }: { state: State }) {
  if (state === "loading") {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2
          aria-hidden="true"
          className="h-5 w-5 animate-spin text-muted-foreground"
        />
      </div>
    );
  }
  if (state === "empty") {
    return (
      <EmptyState
        variant="inline"
        size="sm"
        icon={Search}
        title="Nothing matches that search"
        description="No repo name or description contains that string."
      />
    );
  }
  if (state === "error") {
    return (
      <InlineAlert tone="error">
        The request was rejected: this account does not have permission to read
        that resource.
      </InlineAlert>
    );
  }
  if (state === "long") {
    return (
      <div className="space-y-3 text-sm leading-relaxed text-muted-foreground">
        {Array.from({ length: 12 }, (_, i) => (
          <p key={i}>{LOREM}</p>
        ))}
      </div>
    );
  }
  if (state === "many") {
    return (
      <div className="divide-y divide-border/60 rounded-md border border-border">
        {ROWS.map((row) => (
          <div
            key={row.id}
            className="flex items-center justify-between gap-3 px-3 py-2"
          >
            <span className="truncate font-mono text-xs text-foreground">
              {row.name}
            </span>
            <span className="shrink-0 text-[11px] text-muted-foreground">
              {row.note}
            </span>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="wb-name">Display name</Label>
        <Input id="wb-name" defaultValue="Production frontend" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="wb-host">Hostname</Label>
        <Input id="wb-host" placeholder="app.example.com" />
      </div>
      <p className="text-sm leading-relaxed text-muted-foreground">{LOREM}</p>
    </div>
  );
}

function FooterButtons({ close, state }: { close: () => void; state: State }) {
  return (
    <>
      <Button variant="outline" onClick={close}>
        Cancel
      </Button>
      <Button className="gap-2" disabled={state === "loading"}>
        {state === "loading" && (
          <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
        )}
        Save changes
      </Button>
    </>
  );
}

function dialogSpecimen(
  id: string,
  name: string,
  size: "sm" | "md" | "lg" | "xl",
  variant: "shell" | "compact",
): Specimen {
  return {
    id,
    name,
    group: "Grammar",
    tier: variant,
    size,
    source: "components/ui/dialog.tsx",
    states: STATES,
    render: (state, close) => (
      <Dialog open onOpenChange={close}>
        <DialogContent variant={variant} size={size}>
          <DialogHeader>
            <DialogTitle>{name}</DialogTitle>
            <DialogDescription>
              Tier {variant}, size {size}, state {state}.
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <StateBody state={state} />
          </DialogBody>
          <DialogFooter>
            <FooterButtons close={close} state={state} />
          </DialogFooter>
        </DialogContent>
      </Dialog>
    ),
  };
}

const SPECIMENS: Specimen[] = [
  dialogSpecimen("shell-sm", "Dialog shell", "sm", "shell"),
  dialogSpecimen("shell-md", "Dialog shell", "md", "shell"),
  dialogSpecimen("shell-lg", "Dialog shell", "lg", "shell"),
  dialogSpecimen("shell-xl", "Dialog shell", "xl", "shell"),
  dialogSpecimen("compact-sm", "Dialog compact", "sm", "compact"),
  dialogSpecimen("compact-md", "Dialog compact", "md", "compact"),
  {
    id: "modal-shell",
    name: "ModalShell",
    group: "Grammar",
    tier: "overlay",
    size: "md",
    source: "components/ui/modal-shell.tsx",
    states: STATES,
    render: (state, close) => (
      <ModalShell
        open
        onClose={close}
        title="Rule details"
        description="Whitelist entry, matched 41 times in the last 24 hours."
        icon={<Shield aria-hidden="true" className="h-4 w-4 text-primary" />}
        size="md"
        footer={<FooterButtons close={close} state={state} />}
      >
        <StateBody state={state} />
      </ModalShell>
    ),
  },
  {
    id: "modal-shell-no-footer",
    name: "ModalShell, read only",
    group: "Grammar",
    tier: "overlay",
    size: "lg",
    source: "components/ui/modal-shell.tsx",
    states: ["default", "many", "long"],
    render: (state, close) => (
      <ModalShell
        open
        onClose={close}
        title="Team members"
        size="lg"
        description="Nine people, two pending invites."
      >
        <StateBody state={state} />
      </ModalShell>
    ),
  },
  {
    id: "sheet",
    name: "Sheet",
    group: "Grammar",
    tier: "sheet",
    size: "w-64",
    source: "components/ui/sheet.tsx",
    states: ["default", "many"],
    render: (state, close) => (
      <Sheet open onOpenChange={close}>
        <SheetContent side="right">
          <SheetHeader>
            <SheetTitle>Navigation</SheetTitle>
          </SheetHeader>
          <SheetBody>
            <StateBody state={state} />
          </SheetBody>
          <SheetFooter>
            <Button variant="outline" onClick={close}>
              Close
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    ),
  },
  {
    id: "confirm",
    name: "ConfirmDialog",
    group: "Real components",
    tier: "compact",
    size: "sm",
    source: "components/shared/confirm-dialog.tsx",
    states: ["default", "loading", "error", "long"],
    render: (state, close) => (
      <ConfirmDialog
        open
        title="Delete this scan?"
        description="The report, its findings and any share links stop working immediately. This cannot be undone."
        confirmLabel="Delete scan"
        danger
        busy={state === "loading"}
        error={state === "error" ? "The scan is still running." : null}
        onConfirm={() => {}}
        onCancel={close}
      >
        {state === "long" ? <StateBody state="long" /> : null}
      </ConfirmDialog>
    ),
  },
  {
    id: "confirm-safe",
    name: "ConfirmDialog, non destructive",
    group: "Real components",
    tier: "compact",
    size: "sm",
    source: "components/shared/confirm-dialog.tsx",
    states: ["default"],
    render: (_state, close) => (
      <ConfirmDialog
        open
        title="Re-run this scan?"
        description="It uses one credit and takes about three seconds."
        confirmLabel="Run scan"
        onConfirm={() => {}}
        onCancel={close}
      />
    ),
  },
  {
    id: "share",
    name: "ShareModal",
    group: "Real components",
    tier: "shell",
    size: "sm",
    source: "components/scanner/share-modal.tsx",
    states: ["default", "empty"],
    render: (state, close) => (
      <ShareModal
        open
        onOpenChange={close}
        shareUrl="https://vulnradar.dev/shared/9f3c1a77-4b20-4d0e-8f11-7a2b6d5e0c34"
        publiclyListed={state === "default"}
        onPubliclyListedChange={() => {}}
        expiresAt={state === "default" ? null : new Date().toISOString()}
        onExpiryChange={() => {}}
      />
    ),
  },
];

/**
 * Only `shell` is tinted. It is the tier almost everything should be, so a page
 * of grey badges with one blue one is a modal that probably wants a second
 * look, and a page of blue is the grammar working.
 */
const TIER_STYLE: Record<InventoryEntry["tier"], string> = {
  shell: "border-primary/30 bg-primary/10 text-primary",
  compact: "border-border bg-muted text-muted-foreground",
  sheet: "border-border bg-muted text-muted-foreground",
  overlay: "border-border bg-muted text-muted-foreground",
  takeover: "border-border bg-muted text-muted-foreground",
};

export function ModalWorkbench() {
  const [openId, setOpenId] = useState<string | null>(null);
  const [state, setState] = useState<State>("default");

  const active = SPECIMENS.find((s) => s.id === openId) ?? null;
  const close = () => setOpenId(null);

  const groups = Array.from(new Set(SPECIMENS.map((s) => s.group)));

  return (
    <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <header className="mb-8 border-b border-border pb-6">
        <p className="mb-2 font-mono text-xs uppercase tracking-wide text-muted-foreground">
          Development only
        </p>
        <h1 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
          Modal workbench
        </h1>
        <p className="mt-2 max-w-prose text-sm leading-relaxed text-muted-foreground">
          Every modal surface, openable without reproducing the app state that
          normally hides it. Pick a state first, then open something: the state
          applies to whatever you open next, so you can step through the same
          case across tiers and see where the grammar disagrees with itself.
        </p>
      </header>

      <section className="mb-8">
        <h2 className="mb-3 font-mono text-xs uppercase tracking-wide text-muted-foreground">
          State
        </h2>
        <div className="flex flex-wrap gap-1.5">
          {STATES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setState(s)}
              aria-pressed={state === s}
              className={cn(
                "h-9 rounded-md border px-3 font-mono text-xs transition-colors",
                "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
                state === s
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-input text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {s}
            </button>
          ))}
        </div>
      </section>

      {groups.map((group) => (
        <section key={group} className="mb-8">
          <h2 className="mb-3 font-mono text-xs uppercase tracking-wide text-muted-foreground">
            {group}
          </h2>
          <ul className="divide-y divide-border rounded-lg border border-border">
            {SPECIMENS.filter((s) => s.group === group).map((specimen) => {
              const supported = specimen.states.includes(state);
              return (
                <li
                  key={specimen.id}
                  className="flex flex-wrap items-center gap-3 px-4 py-3"
                >
                  {/* basis-full below sm. The row is flex-wrap, but a
                      `min-w-0 flex-1` column shrinks to nothing rather than
                      forcing a wrap, so the tier badge and the size cell were
                      taking the width and the name and its path (both strings
                      we wrote) were the things clipped. */}
                  <span className="min-w-0 flex-1 basis-full sm:basis-0">
                    <span className="block text-sm font-medium text-foreground">
                      {specimen.name}
                    </span>
                    <span className="block wrap-anywhere font-mono text-[11px] text-muted-foreground">
                      {specimen.source}
                    </span>
                  </span>
                  <span
                    className={cn(
                      "rounded-md border px-2 py-0.5 font-mono text-[11px]",
                      TIER_STYLE[specimen.tier],
                    )}
                  >
                    {specimen.tier}
                  </span>
                  <span className="w-10 shrink-0 text-right font-mono text-[11px] text-muted-foreground">
                    {specimen.size}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!supported}
                    onClick={() => setOpenId(specimen.id)}
                    title={
                      supported
                        ? undefined
                        : `This one has no ${state} state to show`
                    }
                  >
                    Open
                  </Button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      <section>
        <h2 className="mb-3 font-mono text-xs uppercase tracking-wide text-muted-foreground">
          Inventory
        </h2>
        <p className="mb-3 max-w-prose text-sm leading-relaxed text-muted-foreground">
          Every modal in the product and the tier it uses. A row that is not
          also a specimen above needs real app state to render, so it is listed
          rather than launched.
        </p>
        <ul className="divide-y divide-border rounded-lg border border-border">
          {MODAL_INVENTORY.map((entry) => (
            <li
              key={entry.source + entry.name}
              className="flex flex-wrap items-center gap-3 px-4 py-2"
            >
              {/* Same shape as the specimen rows above, same reason. */}
              <span className="min-w-0 flex-1 basis-full sm:basis-0">
                <span className="block text-sm text-foreground">
                  {entry.name}
                </span>
                <span className="block wrap-anywhere font-mono text-[11px] text-muted-foreground">
                  {entry.source}
                </span>
              </span>
              <span
                className={cn(
                  "rounded-md border px-2 py-0.5 font-mono text-[11px]",
                  TIER_STYLE[entry.tier],
                )}
              >
                {entry.tier}
              </span>
              <span className="w-10 shrink-0 text-right font-mono text-[11px] text-muted-foreground">
                {entry.size}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {active?.render(state, close)}

      <p className="mt-10 flex items-center gap-2 text-xs text-muted-foreground">
        <AlertTriangle aria-hidden="true" className="h-3.5 w-3.5" />
        This route is not built in production. See app/dev/modals/page.tsx.
      </p>
    </main>
  );
}
