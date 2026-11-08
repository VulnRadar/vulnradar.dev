"use client";

import { useId, useState } from "react";
import { AlertTriangle, CheckCircle2, Gift, Tag } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { EditDialog, KEEP_OPEN } from "@/components/shared/edit-dialog";
import { LeadingIcon } from "@/components/shared/leading-icon";
import { AdminPasswordConfirmDialog } from "@/components/admin/shared";
import type { BadgeDef, UserDetail } from "@/components/admin/types";
import { STAFF_ROLES, STAFF_ROLE_LABELS } from "@/lib/config/client-constants";
import { PLANS, getPlanById } from "@/lib/billing/catalog";
import { hasGodMode } from "@/lib/auth/permissions-client";
import { formatDate } from "@/lib/ui/format-date";
import { cn } from "@/lib/ui/utils";

/**
 * The panel had three native selects styled three ways (h-8 text-xs, h-9
 * text-xs, h-10 rounded-lg), so Plan, Staff Role and credit Type looked like
 * three kinds of control. One recipe, sized like the inputs beside them.
 */
export const NATIVE_SELECT_CLASS =
  "h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60";

export type SaveResult = { ok: boolean; error?: string };

/** What saveAccountChanges in the panel accepts: only the fields that moved. */
export interface AccountChanges {
  name?: string;
  email?: string;
  plan?: string;
  role?: string;
}

export interface AccountSaveOptions {
  /** The caller's own password, for the gated writes (email, role). */
  password?: string;
  notifyUser: boolean;
}

export type SaveAccountChanges = (
  changes: AccountChanges,
  opts: AccountSaveOptions,
) => Promise<SaveResult>;

type AccountUser = Pick<
  UserDetail["user"],
  "name" | "email" | "plan" | "role" | "gifted_plan" | "gift_end_date"
>;

export interface AccountDraft {
  name: string;
  email: string;
  plan: string;
}

export function accountDraftFrom(user: AccountUser): AccountDraft {
  return {
    name: user.name || "",
    email: user.email,
    plan: user.plan || "free",
  };
}

/**
 * The fields this save sends, measured against the record as it is now
 * rather than as it was when the dialog opened. After a save that got part
 * way (the name went through, then the password was wrong for the email),
 * the panel has refetched, so trying again sends only what is still
 * different instead of writing the name and its audit line a second time.
 *
 * Email and plan are only ever sent by a role that may edit them, whatever
 * the draft holds, and a gifted plan is not edited here at all.
 */
export function accountChanges(
  user: AccountUser,
  draft: AccountDraft,
  canEditEmailAndPlan: boolean,
): AccountChanges {
  const changes: AccountChanges = {};
  const name = draft.name.trim();
  if (name !== (user.name || "")) changes.name = name;
  if (canEditEmailAndPlan) {
    const email = draft.email.trim().toLowerCase();
    if (email !== user.email) changes.email = email;
    if (!user.gifted_plan && draft.plan !== (user.plan || "free")) {
      changes.plan = draft.plan;
    }
  }
  return changes;
}

export function accountEmailMissing(
  draft: AccountDraft,
  canEditEmailAndPlan: boolean,
): boolean {
  return canEditEmailAndPlan && draft.email.trim() === "";
}

/**
 * The roles the picker offers. Super admin only appears for an account that
 * already is one, so that it can be shown as the current value; the server
 * refuses to assign it to anyone (app/api/v3/admin/route.ts, set_role).
 */
export function staffRoleOptions(currentRole: string | null): string[] {
  return Object.values(STAFF_ROLES).filter(
    (role) => role !== STAFF_ROLES.SUPER_ADMIN || hasGodMode(currentRole),
  );
}

export function toggleId(ids: readonly number[], id: number): number[] {
  return ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
}

/**
 * The awards and revokes a badge save sends, against what is awarded now. A
 * badge that a partly failed save already awarded is not awarded again, and
 * one it already removed is not removed again.
 */
export function badgeChanges(
  awardedIds: readonly number[],
  toAward: readonly number[],
  toRevoke: readonly number[],
): { awards: number[]; revokes: number[] } {
  return {
    awards: toAward.filter((id) => !awardedIds.includes(id)),
    revokes: toRevoke.filter((id) => awardedIds.includes(id)),
  };
}

export function noteCanSave(original: string, draft: string): boolean {
  const next = draft.trim();
  return next !== "" && next !== original.trim();
}

function displayName(user: Pick<AccountUser, "name" | "email">): string {
  return user.name || user.email;
}

function NotifyCheckbox({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="mt-4 flex items-center gap-2">
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(state) => onChange(state === true)}
      />
      {/* The label is the target: the box itself is 16px, and the padding
          here takes the clickable row past the 24px floor. */}
      <Label htmlFor={id} className="py-1 text-sm font-normal">
        Email them about the change
      </Label>
    </div>
  );
}

export function EditAccountDialog({
  user,
  canEditEmailAndPlan,
  onSave,
  onClose,
}: {
  user: AccountUser;
  /** perms.canManageStaff: email and plan are admin-only. */
  canEditEmailAndPlan: boolean;
  onSave: SaveAccountChanges;
  onClose: () => void;
}) {
  const [initial] = useState(() => accountDraftFrom(user));
  const [draft, setDraft] = useState(initial);
  const [confirming, setConfirming] = useState(false);
  const nameId = useId();
  const emailId = useId();
  const emailErrorId = useId();
  const planId = useId();

  const changes = accountChanges(user, draft, canEditEmailAndPlan);
  const emailMissing = accountEmailMissing(draft, canEditEmailAndPlan);
  const dirty =
    draft.name !== initial.name ||
    draft.email !== initial.email ||
    draft.plan !== initial.plan;
  const who = displayName(user);

  return (
    <>
      <EditDialog
        open
        onOpenChange={(open) => !open && onClose()}
        title="Edit account"
        description={`Changes to ${who}'s account.`}
        dirty={dirty}
        canSave={Object.keys(changes).length > 0 && !emailMissing}
        onSave={() => {
          // Changing an account's email redirects every future password
          // reset, so it is password-gated on the server. The dialog stays
          // open under the password prompt and closes when that save does.
          if (changes.email !== undefined) {
            setConfirming(true);
            return KEEP_OPEN;
          }
          // Account changes always tell the user. This is not a choice made
          // here: the old save bar let an unticked box on one save carry
          // into the next one, which then went out without an email.
          return onSave(changes, { notifyUser: true });
        }}
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor={nameId}>Display name</Label>
            <Input
              id={nameId}
              name="name"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="Not set"
              autoComplete="off"
              autoFocus
            />
          </div>

          {canEditEmailAndPlan && (
            <div className="flex flex-col gap-2">
              <Label htmlFor={emailId}>Email address</Label>
              <Input
                id={emailId}
                name="email"
                type="email"
                value={draft.email}
                onChange={(e) => setDraft({ ...draft, email: e.target.value })}
                autoComplete="off"
                required
                aria-invalid={emailMissing}
                aria-describedby={emailMissing ? emailErrorId : undefined}
                className={cn(
                  emailMissing &&
                    "border-destructive focus-visible:ring-destructive",
                )}
              />
              {emailMissing && (
                <p
                  id={emailErrorId}
                  role="alert"
                  className="text-xs text-destructive"
                >
                  Email is required
                </p>
              )}
            </div>
          )}

          {canEditEmailAndPlan &&
            (user.gifted_plan ? (
              <div className="flex flex-col gap-2">
                <p className="text-sm font-medium">Plan</p>
                <div className="flex h-9 items-center gap-2 rounded-md border border-[hsl(var(--warning))]/30 bg-[hsl(var(--warning))]/10 px-3 text-sm text-[hsl(var(--warning))]">
                  <Gift className="h-3.5 w-3.5" aria-hidden="true" />
                  {getPlanById(user.gifted_plan)?.name || user.gifted_plan}
                </div>
                <p className="text-xs text-muted-foreground">
                  Gifted until{" "}
                  {user.gift_end_date ? formatDate(user.gift_end_date) : "N/A"}.
                  Use the Gift button above to modify.
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <Label htmlFor={planId}>Plan</Label>
                <select
                  id={planId}
                  name="plan"
                  value={draft.plan}
                  onChange={(e) => setDraft({ ...draft, plan: e.target.value })}
                  className={cn(NATIVE_SELECT_CLASS, "w-full")}
                >
                  {PLANS.map((plan) => (
                    <option key={plan.id} value={plan.id}>
                      {plan.name}
                    </option>
                  ))}
                </select>
              </div>
            ))}

          <div className="flex items-start gap-2 rounded-lg border border-border/40 bg-muted/30 p-3">
            <LeadingIcon
              icon={AlertTriangle}
              line="xs-relaxed"
              size="sm"
              className="text-muted-foreground"
            />
            <p className="text-xs leading-relaxed text-muted-foreground">
              Changes are logged in the audit log. An email change asks for your
              password first. Plan changes take effect immediately.
            </p>
          </div>
          <p className="text-xs text-muted-foreground">
            They get one email listing what changed. A new email address is also
            announced to the old one.
          </p>
        </div>
      </EditDialog>

      <AdminPasswordConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Confirm Account Changes"
        description={`Re-enter your password to save these changes to ${who}'s account.`}
        confirmLabel="Save Changes"
        onConfirm={async (password) => {
          const result = await onSave(
            accountChanges(user, draft, canEditEmailAndPlan),
            { password, notifyUser: true },
          );
          if (result.ok) {
            setConfirming(false);
            onClose();
          }
          return result;
        }}
      />
    </>
  );
}

export function ChangeStaffRoleDialog({
  user,
  onSave,
  onClose,
}: {
  user: Pick<AccountUser, "name" | "email" | "role">;
  onSave: SaveAccountChanges;
  onClose: () => void;
}) {
  const current = user.role || "user";
  const [role, setRole] = useState(current);
  const [notifyUser, setNotifyUser] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const roleId = useId();
  const who = displayName(user);

  return (
    <>
      <EditDialog
        open
        onOpenChange={(open) => !open && onClose()}
        title="Change staff role"
        description={`What ${who} can see and do in the admin panel changes as soon as you save.`}
        size="sm"
        saveLabel="Change role"
        dirty={role !== current}
        canSave={role !== current}
        onSave={() => {
          // set_role is password-gated on the server.
          setConfirming(true);
          return KEEP_OPEN;
        }}
      >
        <div className="flex flex-col gap-2">
          <Label htmlFor={roleId}>Staff role</Label>
          <select
            id={roleId}
            name="role"
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className={cn(NATIVE_SELECT_CLASS, "w-full")}
            autoFocus
          >
            {staffRoleOptions(user.role).map((option) => (
              <option key={option} value={option}>
                {STAFF_ROLE_LABELS[option] || option}
                {option === current ? " (current)" : ""}
              </option>
            ))}
          </select>
        </div>
        <NotifyCheckbox checked={notifyUser} onChange={setNotifyUser} />
      </EditDialog>

      <AdminPasswordConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Confirm Role Change"
        description={`Re-enter your password to make ${who} ${STAFF_ROLE_LABELS[role] || role}.`}
        confirmLabel="Change role"
        onConfirm={async (password) => {
          const result = await onSave({ role }, { password, notifyUser });
          if (result.ok) {
            setConfirming(false);
            onClose();
          }
          return result;
        }}
      />
    </>
  );
}

function BadgeToggle({
  badge,
  intent,
  pressed,
  label,
  onToggle,
}: {
  badge: BadgeDef;
  /** What pressing it queues. A queued removal is struck through, a queued
   *  award is ringed and ticked, so the two lists cannot be confused. */
  intent: "award" | "remove";
  pressed: boolean;
  label: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      aria-label={label}
      onClick={onToggle}
      className={cn(
        "flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-xs font-medium transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
        pressed && intent === "award" && "ring-2 ring-primary",
        pressed && intent === "remove" && "line-through opacity-60",
      )}
      style={{
        borderColor: `${badge.color}40`,
        backgroundColor: `${badge.color}15`,
        color: badge.color || undefined,
      }}
    >
      <Tag className="h-3 w-3 shrink-0" aria-hidden="true" />
      {badge.display_name}
      {pressed && intent === "award" && (
        <CheckCircle2 className="ml-0.5 h-3 w-3" aria-hidden="true" />
      )}
    </button>
  );
}

export function EditBadgesDialog({
  user,
  awarded,
  allBadges,
  onSave,
  onClose,
}: {
  user: Pick<AccountUser, "name" | "email">;
  awarded: readonly BadgeDef[];
  allBadges: readonly BadgeDef[];
  onSave: (
    awards: number[],
    revokes: number[],
    notifyUser: boolean,
  ) => Promise<SaveResult>;
  onClose: () => void;
}) {
  const [toAward, setToAward] = useState<number[]>([]);
  const [toRevoke, setToRevoke] = useState<number[]>([]);
  const [notifyUser, setNotifyUser] = useState(true);
  const awardedIds = awarded.map((b) => b.id);
  const unawarded = allBadges.filter((b) => !awardedIds.includes(b.id));
  const { awards, revokes } = badgeChanges(awardedIds, toAward, toRevoke);
  const changed = awards.length + revokes.length > 0;

  return (
    <EditDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title="Edit badges"
      description={`Cosmetic badges shown on ${displayName(user)}'s profile.`}
      size="lg"
      saveLabel="Save badges"
      dirty={changed}
      canSave={changed}
      onSave={() => onSave(awards, revokes, notifyUser)}
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium text-muted-foreground">
            Awarded: select one to remove it
          </p>
          {awarded.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {awarded.map((badge) => {
                const queued = revokes.includes(badge.id);
                return (
                  <BadgeToggle
                    key={badge.id}
                    badge={badge}
                    intent="remove"
                    pressed={queued}
                    label={`${queued ? "Queued to remove" : "Remove badge"} ${badge.display_name}`}
                    onToggle={() => setToRevoke(toggleId(toRevoke, badge.id))}
                  />
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              No badges awarded yet.
            </p>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium text-muted-foreground">
            Not awarded: select one to award it
          </p>
          {unawarded.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {unawarded.map((badge) => (
                <BadgeToggle
                  key={badge.id}
                  badge={badge}
                  intent="award"
                  pressed={awards.includes(badge.id)}
                  label={`Award ${badge.display_name}`}
                  onToggle={() => setToAward(toggleId(toAward, badge.id))}
                />
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Every badge has been awarded.
            </p>
          )}
        </div>
      </div>
      <NotifyCheckbox checked={notifyUser} onChange={setNotifyUser} />
    </EditDialog>
  );
}

export function EditNoteDialog({
  note,
  onSave,
  onClose,
}: {
  note: { id: number; text: string };
  /** Gets the trimmed text. */
  onSave: (text: string) => Promise<SaveResult>;
  onClose: () => void;
}) {
  const [text, setText] = useState(note.text);
  const fieldId = useId();
  return (
    <EditDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title="Edit note"
      description="Only staff see admin notes. The user sees them only in a data export."
      saveLabel="Save note"
      dirty={text !== note.text}
      canSave={noteCanSave(note.text, text)}
      onSave={() => onSave(text.trim())}
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor={fieldId}>Note</Label>
        <Textarea
          id={fieldId}
          name="note"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={6}
          autoFocus
        />
      </div>
    </EditDialog>
  );
}
