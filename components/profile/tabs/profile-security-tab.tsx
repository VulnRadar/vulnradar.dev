"use client";

import { useState, useEffect, useRef } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Copy,
  Download,
  KeyRound,
  Check,
  Loader2,
  LogOut,
  ShieldOff,
  ArrowRight,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/ui/utils";
import {
  API,
  ROUTES,
  APP_NAME,
  APP_SLUG,
  PASSWORD_MIN_LENGTH,
} from "@/lib/config/client-constants";
import { downloadBlob } from "@/lib/ui/download";
import { formatDateTime } from "@/lib/ui/format-date";
import {
  refreshAuthCache,
  clearAuthCache,
} from "@/components/providers/auth-provider";
import type { ProfileTabProps } from "@/components/profile/types";
import { EditDialog, KEEP_OPEN } from "@/components/shared/edit-dialog";
import { LeadingIcon } from "@/components/shared/leading-icon";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { useConfirm } from "@/components/shared/use-confirm";
import {
  useCopyFeedback,
  CopiedAnnouncement,
} from "@/components/shared/copy-feedback";

// The API issues this many backup codes per set. Kept as one named value so
// the copy and the progress readout cannot drift apart.
const BACKUP_CODE_SET_SIZE = 8;

type EnrolStep = "scan" | "verify";

// Shapes returned by GET /api/v3/auth/sessions and GET
// /api/v3/auth/trusted-devices. Neither ever includes the real session id
// or device fingerprint -- see the routes for why -- so there is nothing
// here a leaked response could be replayed as.
interface SessionItem {
  id: string;
  ipAddress: string | null;
  // IPv4 captured out-of-band when the session's own connection was IPv6.
  ipv4Address: string | null;
  device: string;
  createdAt: string;
  expiresAt: string;
  isCurrent: boolean;
}

interface TrustedDeviceItem {
  id: number;
  deviceName: string | null;
  ipAddress: string | null;
  device: string;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
  isCurrent: boolean;
}

/** Section shell: a left-aligned heading with prose, then the content. */
function Section({
  title,
  blurb,
  aside,
  children,
}: {
  title: string;
  blurb: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h2 className="text-base font-semibold tracking-tight text-foreground">
            {title}
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">{blurb}</p>
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** Inline status pill driven by semantic tokens, readable in both themes. */
function StatusPill({
  tone,
  children,
}: {
  tone: "on" | "off";
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium shrink-0",
        tone === "on"
          ? "bg-[hsl(var(--success))]/10 text-[hsl(var(--success))] border-[hsl(var(--success))]/30"
          : "bg-muted text-muted-foreground border-border",
      )}
    >
      {tone === "on" ? <Check className="h-3 w-3" aria-hidden="true" /> : null}
      {children}
    </span>
  );
}

const NETWORK_ERROR =
  "We could not reach the server. Check your connection and try again.";

type SendResult =
  { ok: true; data: { backupCodes?: string[] } } | { ok: false; error: string };

// Every password below goes into the body exactly as it was typed. The server
// compares it with the stored hash as is, so a trimmed copy of a password
// that starts or ends with a space can never pass the re-auth check, and
// every refused attempt still counts against the rate limit.
async function sendJson(
  url: string,
  method: "POST" | "PATCH" | "DELETE",
  body: unknown,
  fallback: string,
): Promise<SendResult> {
  try {
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (res.ok) return { ok: true, data };
    return { ok: false, error: data.error || fallback };
  } catch {
    return { ok: false, error: NETWORK_ERROR };
  }
}

export interface PasswordDraft {
  current: string;
  next: string;
  confirm: string;
}

export const EMPTY_PASSWORD_DRAFT: PasswordDraft = {
  current: "",
  next: "",
  confirm: "",
};

/** The sentence that keeps the password dialog open, or null when it can save. */
export function passwordDraftProblem(
  draft: PasswordDraft,
  hasPassword: boolean,
): string | null {
  if (hasPassword && !draft.current) {
    return "Enter your current password to change it.";
  }
  if (!draft.next || !draft.confirm) {
    return hasPassword
      ? "Fill in all three fields to change your password."
      : "Fill in both password fields to set one.";
  }
  if (draft.next !== draft.confirm) {
    return "The two new password fields do not match. Retype them and try again.";
  }
  // The constant, not an 8 typed here. The server resolves
  // PASSWORD_MIN_LENGTH, which is 12, so a 9-character password passed this
  // gate and was then rejected by the API: the user was told the rule, met
  // it, and was refused anyway. config-values.ts records that this same
  // 8-versus-12 split was already found and fixed once; this was the third
  // site it survived in, and the three sibling forms (signup, reset,
  // staff-invite) all read the constant correctly.
  if (draft.next.length < PASSWORD_MIN_LENGTH) {
    return `Your new password needs at least ${PASSWORD_MIN_LENGTH} characters. Add a few more.`;
  }
  return null;
}

export function passwordUpdateBody(draft: PasswordDraft, hasPassword: boolean) {
  return {
    currentPassword: hasPassword ? draft.current : undefined,
    newPassword: draft.next,
  };
}

export function isPasswordDraftDirty(draft: PasswordDraft): boolean {
  return draft.current !== "" || draft.next !== "" || draft.confirm !== "";
}

/** Resolves to the message that keeps the dialog open, or null once saved. */
export async function savePassword(
  draft: PasswordDraft,
  hasPassword: boolean,
): Promise<string | null> {
  const problem = passwordDraftProblem(draft, hasPassword);
  if (problem) return problem;
  const result = await sendJson(
    API.AUTH.UPDATE,
    "PATCH",
    passwordUpdateBody(draft, hasPassword),
    "We could not save your password. Try again.",
  );
  return result.ok ? null : result.error;
}

export async function regenerateBackupCodes(
  password: string,
): Promise<{ ok: true; codes: string[] } | { ok: false; error: string }> {
  const result = await sendJson(
    API.AUTH.TWO_FA.BACKUP_CODES,
    "POST",
    { password },
    "We could not generate new codes. Check your password and try again.",
  );
  if (!result.ok) return result;
  return { ok: true, codes: result.data.backupCodes ?? [] };
}

export async function verifyAuthenticator(
  code: string,
  password: string,
): Promise<{ ok: true; codes: string[] } | { ok: false; error: string }> {
  const result = await sendJson(
    API.AUTH.TWO_FA.SETUP,
    "POST",
    { code, currentPassword: password },
    "That code did not match. Codes expire every 30 seconds, so try the current one.",
  );
  if (!result.ok) return result;
  return { ok: true, codes: result.data.backupCodes ?? [] };
}

export async function enableEmailCodes(
  password: string,
): Promise<string | null> {
  const result = await sendJson(
    API.AUTH.TWO_FA.EMAIL_SETUP,
    "POST",
    { password },
    "That password was not accepted. Try again.",
  );
  return result.ok ? null : result.error;
}

export type TwoFactorMethod = "app" | "email";

export function turnOffTwoFactorRequest(method: TwoFactorMethod): {
  url: string;
  method: "POST" | "DELETE";
} {
  return method === "app"
    ? { url: API.AUTH.TWO_FA.DISABLE, method: "POST" }
    : { url: API.AUTH.TWO_FA.EMAIL_SETUP, method: "DELETE" };
}

export async function turnOffTwoFactor(
  method: TwoFactorMethod,
  password: string,
): Promise<string | null> {
  const request = turnOffTwoFactorRequest(method);
  const result = await sendJson(
    request.url,
    request.method,
    { password },
    "That password was not accepted. Try again.",
  );
  return result.ok ? null : result.error;
}

function closeOnly(onClose: () => void) {
  return (open: boolean) => {
    if (!open) onClose();
  };
}

export function PasswordDialog({
  hasPassword,
  onClose,
  onSaved,
}: {
  hasPassword: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<PasswordDraft>(EMPTY_PASSWORD_DRAFT);
  const set =
    (key: keyof PasswordDraft) => (e: { target: { value: string } }) =>
      setDraft((d) => ({ ...d, [key]: e.target.value }));
  return (
    <EditDialog
      open
      onOpenChange={closeOnly(onClose)}
      size="sm"
      title={hasPassword ? "Change your password" : "Set a password"}
      description="Saving signs out every other device, makes trusted devices pass two-step again and revokes your API keys. This device stays signed in."
      saveLabel={hasPassword ? "Update password" : "Set password"}
      savingLabel={hasPassword ? "Updating..." : "Saving..."}
      dirty={isPasswordDraftDirty(draft)}
      onSave={async () => {
        const error = await savePassword(draft, hasPassword);
        if (error) return error;
        onSaved();
      }}
    >
      <div className="flex flex-col gap-4">
        {hasPassword && (
          <div className="flex flex-col gap-2">
            <Label htmlFor="sec-current-pw">Current password</Label>
            <Input
              id="sec-current-pw"
              type="password"
              autoComplete="current-password"
              autoFocus
              value={draft.current}
              onChange={set("current")}
              className="h-10"
            />
          </div>
        )}
        <div className="flex flex-col gap-2">
          <Label htmlFor="sec-new-pw">New password</Label>
          <Input
            id="sec-new-pw"
            type="password"
            autoComplete="new-password"
            autoFocus={!hasPassword}
            value={draft.next}
            onChange={set("next")}
            className="h-10"
            aria-describedby="sec-new-pw-hint"
          />
          <p id="sec-new-pw-hint" className="text-xs text-muted-foreground">
            At least {PASSWORD_MIN_LENGTH} characters.
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="sec-confirm-new-pw">Confirm new password</Label>
          <Input
            id="sec-confirm-new-pw"
            type="password"
            autoComplete="new-password"
            value={draft.confirm}
            onChange={set("confirm")}
            className="h-10"
          />
        </div>
      </div>
    </EditDialog>
  );
}

/** One password field, the shape every confirm-with-password dialog shares. */
function PasswordField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="password"
        autoComplete="current-password"
        autoFocus
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-10"
      />
    </div>
  );
}

export function RegenerateBackupCodesDialog({
  onClose,
  onIssued,
  returnFocusRef,
}: {
  onClose: () => void;
  /** Hands the new set to the tab, whose takeover panel is the one place it shows. */
  onIssued: (codes: string[]) => void;
  returnFocusRef?: React.RefObject<HTMLElement | null>;
}) {
  const [password, setPassword] = useState("");
  return (
    <EditDialog
      open
      onOpenChange={closeOnly(onClose)}
      tier="compact"
      size="sm"
      destructive
      title="Generate new backup codes?"
      description={`Your ${BACKUP_CODE_SET_SIZE} current codes stop working the moment new ones are issued.`}
      saveLabel="Generate new codes"
      savingLabel="Generating..."
      dirty={password !== ""}
      canSave={password !== ""}
      returnFocusRef={returnFocusRef}
      onSave={async () => {
        const result = await regenerateBackupCodes(password);
        if (!result.ok) return result.error;
        onIssued(result.codes);
      }}
    >
      <PasswordField
        id="regen-backup-password"
        label="Confirm your password"
        value={password}
        onChange={setPassword}
      />
    </EditDialog>
  );
}

export interface AuthenticatorSetup {
  uri: string;
  secret: string;
}

export function AuthenticatorSetupDialog({
  setup,
  onClose,
  onEnabled,
  returnFocusRef,
}: {
  setup: AuthenticatorSetup;
  /** resetEnrolment: any way out drops the half-finished secret. */
  onClose: () => void;
  onEnabled: (codes: string[]) => void;
  returnFocusRef?: React.RefObject<HTMLElement | null>;
}) {
  const [enrolStep, setEnrolStep] = useState<EnrolStep>("scan");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const codeInputRef = useRef<HTMLInputElement>(null);

  // Move focus to the code field when the verify step appears, so the flow
  // reads in order and Enter there verifies. The step flips while the save
  // that flipped it is still settling, and EditDialog holds every field in a
  // disabled fieldset until it has, so a focus() straight away lands on a
  // disabled input and is dropped. Wait a few frames for it to enable.
  useEffect(() => {
    if (enrolStep !== "verify") return;
    let frame = 0;
    let tries = 0;
    const focusWhenEnabled = () => {
      const input = codeInputRef.current;
      if (input && !input.matches(":disabled")) {
        input.focus();
        return;
      }
      if (++tries < 30) frame = requestAnimationFrame(focusWhenEnabled);
    };
    focusWhenEnabled();
    return () => cancelAnimationFrame(frame);
  }, [enrolStep]);

  const verifying = enrolStep === "verify";
  return (
    <EditDialog
      open
      onOpenChange={closeOnly(onClose)}
      size="md"
      title="Set up an authenticator app"
      description="Two steps: add the account to your app, then prove it works with a code."
      saveLabel={verifying ? "Verify and turn on" : "I have added it"}
      savingLabel="Verifying..."
      dirty={code !== "" || password !== ""}
      canSave={!verifying || (code.length === 6 && password !== "")}
      returnFocusRef={returnFocusRef}
      onSave={async () => {
        if (!verifying) {
          setEnrolStep("verify");
          return KEEP_OPEN;
        }
        const result = await verifyAuthenticator(code, password);
        if (!result.ok) return result.error;
        onEnabled(result.codes);
      }}
    >
      <div className="flex flex-col gap-4">
        <ol className="flex items-center gap-2 text-xs">
          {(
            [
              ["scan", "Scan"],
              ["verify", "Verify"],
            ] as const
          ).map(([id, label], i) => {
            const done = verifying && id === "scan";
            const current = enrolStep === id;
            return (
              <li key={id} className="flex items-center gap-2">
                {i > 0 && (
                  <ChevronRight
                    className="h-3.5 w-3.5 text-muted-foreground/50"
                    aria-hidden="true"
                  />
                )}
                <span
                  aria-current={current ? "step" : undefined}
                  className={cn(
                    "font-medium",
                    current
                      ? "text-primary"
                      : done
                        ? "text-foreground"
                        : "text-muted-foreground",
                  )}
                >
                  {i + 1}. {label}
                </span>
              </li>
            );
          })}
        </ol>

        {!verifying ? (
          <div className="flex flex-col sm:flex-row gap-5">
            {/* The QR quiet zone must stay white in both themes for scanners
                to read it reliably. */}
            <div className="mx-auto sm:mx-0 shrink-0 rounded-lg border border-border bg-white p-3">
              <QRCodeSVG
                value={setup.uri}
                size={160}
                level="M"
                includeMargin={false}
              />
            </div>
            <div className="flex flex-col gap-3 min-w-0">
              <div>
                <p className="text-sm font-semibold text-foreground">
                  Scan this with your authenticator app
                </p>
                <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                  Open the app, add an account, and point the camera here. It
                  will start showing a 6-digit code for {APP_NAME}.
                </p>
              </div>
              <div className="flex flex-col gap-1.5 min-w-0">
                <span className="text-xs text-muted-foreground">
                  Cannot scan? Type this key instead:
                </span>
                <SecretKey secret={setup.secret} />
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">
              Enter the current code from your app, then confirm your password.
            </p>
            <div className="flex flex-col sm:flex-row gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="setup-2fa-code">6-digit code</Label>
                <Input
                  id="setup-2fa-code"
                  ref={codeInputRef}
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  placeholder="000000"
                  value={code}
                  onChange={(e) =>
                    setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                  }
                  className="h-10 w-[180px] text-center text-lg tracking-[0.3em] font-mono"
                />
              </div>
              <div className="flex flex-col gap-2 flex-1 min-w-0">
                <Label htmlFor="setup-2fa-password">Your password</Label>
                <Input
                  id="setup-2fa-password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-10"
                />
              </div>
            </div>
            <Button
              type="button"
              variant="ghost"
              className="self-start"
              onClick={() => setEnrolStep("scan")}
            >
              Back to the QR code
            </Button>
          </div>
        )}
      </div>
    </EditDialog>
  );
}

/** The manual-entry key with its own copy button, for an app that cannot scan. */
function SecretKey({ secret }: { secret: string }) {
  const { copied, copy } = useCopyFeedback();
  return (
    <div className="flex items-start gap-2 min-w-0">
      <code className="min-w-0 flex-1 rounded-md border border-border bg-muted/50 px-3 py-2 font-mono text-xs text-primary break-all select-all">
        {secret}
      </code>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="h-9 w-9 shrink-0"
        onClick={() => void copy(secret)}
        aria-label="Copy the setup key"
      >
        {copied ? (
          <Check className="h-4 w-4" aria-hidden="true" />
        ) : (
          <Copy className="h-4 w-4" aria-hidden="true" />
        )}
      </Button>
      <CopiedAnnouncement copied={copied} noun="setup key" />
    </div>
  );
}

export function EnableEmailCodesDialog({
  email,
  onClose,
  onEnabled,
}: {
  email?: string;
  onClose: () => void;
  onEnabled: () => void;
}) {
  const [password, setPassword] = useState("");
  return (
    <EditDialog
      open
      onOpenChange={closeOnly(onClose)}
      tier="compact"
      size="sm"
      title="Turn on email codes?"
      description={`From your next sign-in, we email a 6-digit code to ${email || "your inbox"} after your password.`}
      saveLabel="Turn on email codes"
      savingLabel="Turning on..."
      dirty={password !== ""}
      canSave={password !== ""}
      onSave={async () => {
        const error = await enableEmailCodes(password);
        if (error) return error;
        onEnabled();
      }}
    >
      <PasswordField
        id="enable-email-2fa-password"
        label="Confirm your password"
        value={password}
        onChange={setPassword}
      />
    </EditDialog>
  );
}

const TURN_OFF_COPY: Record<TwoFactorMethod, string> = {
  app: `Your authenticator entry and all ${BACKUP_CODE_SET_SIZE} backup codes are deleted. After this, your password alone signs you in.`,
  email:
    "We stop emailing sign-in codes. After this, your password alone signs you in.",
};

export function TurnOffTwoFactorDialog({
  method,
  onClose,
  onTurnedOff,
}: {
  method: TwoFactorMethod;
  onClose: () => void;
  onTurnedOff: () => void;
}) {
  const [password, setPassword] = useState("");
  return (
    <EditDialog
      open
      onOpenChange={closeOnly(onClose)}
      tier="compact"
      size="sm"
      destructive
      title="Turn off two-step verification?"
      description={TURN_OFF_COPY[method]}
      saveLabel="Turn off"
      savingLabel="Turning off..."
      cancelLabel="Keep it on"
      dirty={password !== ""}
      canSave={password !== ""}
      onSave={async () => {
        const error = await turnOffTwoFactor(method, password);
        if (error) return error;
        onTurnedOff();
      }}
    >
      <PasswordField
        id={`disable-${method}-2fa-password`}
        label="Confirm your password"
        value={password}
        onChange={setPassword}
      />
    </EditDialog>
  );
}

interface ProfileSecurityTabProps extends ProfileTabProps {
  /**
   * Fires whenever this tab is showing freshly issued backup codes that have
   * not been copied or downloaded yet. Backup codes are shown exactly once,
   * and this tab remounts (dropping its local `backupCodes` state) on every
   * profile-tab switch, so the parent uses this flag to confirm before
   * letting a switch away happen while a set is still unsaved.
   */
  onUnsavedBackupCodesChange?: (hasUnsaved: boolean) => void;
}

export function ProfileSecurityTab(props: ProfileSecurityTabProps) {
  const { confirm, confirmDialog } = useConfirm();
  const {
    user,
    setError,
    setSuccess,
    onTabChange,
    onUnsavedBackupCodesChange,
  } = props;

  // Which dialog is open. Each one owns its own fields, busy state and error,
  // and is mounted only while open, so a password typed into one is gone the
  // moment it closes.
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  const [regenerateOpen, setRegenerateOpen] = useState(false);
  const [totpSetup, setTotpSetup] = useState<AuthenticatorSetup | null>(null);
  const [enableEmailOpen, setEnableEmailOpen] = useState(false);
  const [turnOffMethod, setTurnOffMethod] = useState<TwoFactorMethod | null>(
    null,
  );

  // 2FA state
  const [totpEnabled, setTotpEnabled] = useState(user?.totpEnabled || false);
  const [twoFactorMethod, setTwoFactorMethod] = useState<string | null>(
    user?.twoFactorMethod || null,
  );
  // Keep the parent's `user` in sync with the live 2FA state. This tab remounts
  // on every profile-tab switch and re-seeds the two states above from the
  // `user` prop, so without pushing changes up the parent's stale `user` would
  // make a just-toggled 2FA status silently revert on the next tab switch (a
  // false security all-clear). onUserPatch is a stable ref, so this only fires
  // when the 2FA state actually changes.
  const { onUserPatch } = props;
  useEffect(() => {
    onUserPatch?.({ totpEnabled, twoFactorMethod });
  }, [totpEnabled, twoFactorMethod, onUserPatch]);
  const [startingSetup, setStartingSetup] = useState(false);
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  // null = not confirmed yet (either still loading or the check failed).
  // Defaulting this to 0 would read as "no codes left" before the real
  // count arrives, which falsely tells people to regenerate.
  const [backupCodesRemaining, setBackupCodesRemaining] = useState<
    number | null
  >(null);
  const [backupCodesCheckFailed, setBackupCodesCheckFailed] = useState(false);
  // Whether the codes have EVER been copied, for as long as this set is on
  // screen -- distinct from `copied` below, which is the transient
  // "Copied to clipboard" state every copy button shows for
  // COPIED_FEEDBACK_MS and then clears. codesSaved (below) has to stay true
  // once a copy happens, not blink back to false a couple of seconds later.
  const [codesCopiedEver, setCodesCopiedEver] = useState(false);
  const { copied: codeCopyFeedback, copy: copyBackupCodes } = useCopyFeedback();
  const [codesDownloaded, setCodesDownloaded] = useState(false);

  // Session state
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  // Routed through ConfirmDialog's own `error` prop so a rejected
  // sign-out-everywhere shows inside the still-open dialog instead of only
  // the page-wide banner, which auto-clears after 8 seconds.
  const [logoutError, setLogoutError] = useState<string | null>(null);

  // Active sessions + trusted devices
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [revokingSessionId, setRevokingSessionId] = useState<string | null>(
    null,
  );
  const [trustedDevices, setTrustedDevices] = useState<TrustedDeviceItem[]>([]);
  const [devicesLoading, setDevicesLoading] = useState(true);
  const [revokingDeviceId, setRevokingDeviceId] = useState<number | null>(null);

  const backupPanelRef = useRef<HTMLDivElement>(null);

  // Fetch backup codes remaining count on mount when 2FA is enabled
  useEffect(() => {
    if (totpEnabled && twoFactorMethod === "app") {
      // oxlint-disable-next-line react/set-state-in-effect -- clears any stale failure flag before the fresh fetch-on-mount below runs
      setBackupCodesCheckFailed(false);
      fetch(API.AUTH.TWO_FA.BACKUP_CODES)
        .then((res) => res.json())
        .then((data) => {
          if (typeof data.remaining === "number") {
            setBackupCodesRemaining(data.remaining);
          } else {
            setBackupCodesCheckFailed(true);
          }
        })
        .catch(() => {
          // Say the check failed instead of leaving a number on screen that
          // was never confirmed - a stale "0 left" would be worse than none.
          setBackupCodesCheckFailed(true);
        });
    }
  }, [totpEnabled, twoFactorMethod]);

  // Load the caller's own active sessions on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(API.AUTH.SESSIONS);
        const data = await res.json();
        if (cancelled) return;
        if (res.ok && Array.isArray(data.sessions)) {
          setSessions(data.sessions);
        } else {
          setSessionsError("Could not load your sessions.");
        }
      } catch {
        if (!cancelled) setSessionsError("Could not load your sessions.");
      } finally {
        if (!cancelled) setSessionsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Load trusted devices on mount. Best-effort: an account that has never
  // used 2FA has none, and a failed fetch just leaves the section hidden
  // rather than surfacing an error for a feature the user may not use.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(API.AUTH.TRUSTED_DEVICES);
        const data = await res.json();
        if (!cancelled && res.ok && Array.isArray(data.devices)) {
          setTrustedDevices(data.devices);
        }
      } catch {
        // Section stays hidden below (devicesLoading + empty list).
      } finally {
        if (!cancelled) setDevicesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleRevokeSession(id: string) {
    setRevokingSessionId(id);
    try {
      const res = await fetch(API.AUTH.SESSION_REVOKE(id), {
        method: "DELETE",
      });
      if (res.ok) {
        setSessions((prev) => prev.filter((s) => s.id !== id));
        setSuccess("Session signed out.");
      } else {
        const data = await res.json().catch(() => ({}) as { error?: string });
        setError(
          data.error || "We could not sign out that session. Try again.",
        );
      }
    } catch {
      setError(
        "We could not reach the server. Check your connection and try again.",
      );
    } finally {
      setRevokingSessionId(null);
    }
  }

  async function handleRevokeDevice(id: number) {
    setRevokingDeviceId(id);
    try {
      const res = await fetch(API.AUTH.TRUSTED_DEVICE_REVOKE(id), {
        method: "DELETE",
      });
      if (res.ok) {
        setTrustedDevices((prev) => prev.filter((d) => d.id !== id));
        setSuccess(
          "Device removed. It will need to pass two-step verification again next time.",
        );
      } else {
        const data = await res.json().catch(() => ({}) as { error?: string });
        setError(data.error || "We could not remove that device. Try again.");
      }
    } catch {
      setError(
        "We could not reach the server. Check your connection and try again.",
      );
    } finally {
      setRevokingDeviceId(null);
    }
  }

  // Move focus to the backup codes when they are issued, so the flow reads in
  // order. The dialog that issued them also hands focus here as it closes.
  useEffect(() => {
    if (backupCodes.length > 0) backupPanelRef.current?.focus();
  }, [backupCodes.length]);

  // False only for an OAuth-only account (Google/GitHub/Discord sign-up)
  // that has never set a password. It has no "current password" to enter,
  // so the dialog skips that field and the server-side re-auth gate
  // (app/api/v3/auth/update/route.ts) skips checking one.
  const hasPassword = user?.hasPassword ?? true;

  async function handleForceLogout() {
    setLogoutError(null);
    try {
      const res = await fetch(API.AUTH.SESSIONS, { method: "DELETE" });
      if (res.ok) {
        // Tear down the cached logged-in state (localStorage vr_auth_cache,
        // the injected auth-only CSS, SWR's in-memory me) right away, the
        // same way the header logout does. Without this the redirect below
        // lands on a page whose pre-React blocking script still reads the
        // stale cache and flashes a signed-in shell for an account whose
        // sessions were just revoked.
        clearAuthCache();
        setSuccess("All sessions signed out. Redirecting to sign in.");
        setShowLogoutModal(false);
        // A full document load on purpose, not router.push: this tab's
        // in-memory state belonged to a session that was just revoked.
        setTimeout(() => (window.location.href = ROUTES.LOGIN), 2000);
      } else {
        setLogoutError("We could not sign out your other sessions. Try again.");
      }
    } catch {
      setLogoutError(
        "We could not reach the server. Check your connection and try again.",
      );
    }
  }

  // Every way out of the setup dialog lands here, so a half-finished secret
  // never outlives the dialog that showed it.
  function resetEnrolment() {
    setTotpSetup(null);
  }

  async function startAuthenticatorSetup() {
    setStartingSetup(true);
    try {
      const res = await fetch(API.AUTH.TWO_FA.SETUP);
      const data = await res.json();
      if (res.ok) {
        setTotpSetup({ uri: data.uri, secret: data.secret });
      } else {
        setError(
          data.error || "We could not start setup. Try again in a moment.",
        );
      }
    } catch {
      setError(NETWORK_ERROR);
    } finally {
      setStartingSetup(false);
    }
  }

  // A fresh set from either dialog goes to the takeover below, the one place
  // backup codes are ever shown, and resets the "saved them" flags with it.
  function showIssuedCodes(codes: string[]) {
    setCodesCopiedEver(false);
    setCodesDownloaded(false);
    setBackupCodes(codes);
    setBackupCodesRemaining(codes.length);
  }

  function downloadBackupCodes() {
    const blob = new Blob(
      [
        `${APP_NAME} 2FA Backup Codes\n${"=".repeat(30)}\n\n${backupCodes.join("\n")}\n\nEach code can only be used once.`,
      ],
      { type: "text/plain" },
    );
    downloadBlob(blob, `${APP_SLUG}-backup-codes.txt`);
    setCodesDownloaded(true);
  }

  const appActive = totpEnabled && twoFactorMethod === "app";
  const emailActive = totpEnabled && twoFactorMethod === "email";
  const codesSaved = codesCopiedEver || codesDownloaded;

  // Tell the parent whenever there is a freshly issued, not-yet-saved set of
  // backup codes on screen. Placed ahead of the early return below so it runs
  // on every render (Rules of Hooks), and cleaned up on unmount so a
  // confirmed tab switch does not leave the parent thinking a set is still
  // unsaved once this component is gone.
  useEffect(() => {
    onUnsavedBackupCodesChange?.(backupCodes.length > 0 && !codesSaved);
    return () => onUnsavedBackupCodesChange?.(false);
  }, [backupCodes.length, codesSaved, onUnsavedBackupCodesChange]);

  /* ── The freshly issued backup codes take over the whole tab. They are shown
     once, so nothing else competes with them for attention. ── */
  if (backupCodes.length > 0) {
    return (
      <div
        ref={backupPanelRef}
        tabIndex={-1}
        // a11y (SC 2.4.7): this panel is focused by script the moment backup
        // codes are revealed, and `outline-hidden` killed the native outline
        // while the global :focus-visible rule in app/globals.css explicitly
        // skips [tabindex="-1"], so the keyboard user was moved somewhere
        // with no indication of where. focus: (not focus-visible:) because
        // the focus here is programmatic, which the :focus-visible heuristic
        // does not always honour.
        className="rounded-xl border border-primary/30 bg-primary/4 p-5 sm:p-6 flex flex-col gap-5 focus:outline-hidden focus:ring-2 focus:ring-inset focus:ring-ring"
      >
        <div className="flex items-start gap-3">
          <LeadingIcon
            icon={KeyRound}
            line="lg"
            size="lg"
            className="text-primary"
          />
          <div className="min-w-0">
            <h2 className="text-lg font-semibold tracking-tight text-foreground">
              Save these backup codes now
            </h2>
            <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
              This is the only time they are shown. Each code signs you in once
              if you lose your authenticator app. Without them, losing your
              phone means losing your account.
            </p>
          </div>
        </div>

        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 rounded-lg border border-border bg-card p-4 font-mono text-sm">
          {backupCodes.map((code, i) => (
            <li
              key={i}
              className="flex items-center gap-2 text-foreground select-all"
            >
              <span
                className="text-xs text-muted-foreground tabular-nums w-4 shrink-0"
                aria-hidden="true"
              >
                {i + 1}
              </span>
              {/* break-all, not truncate. This is the one screen where a
                  backup code is ever shown, and a clipped code is a code the
                  reader cannot write down: the ellipsis hides the loss rather
                  than reporting it. Breaking is the safe failure. */}
              <span className="break-all">{code}</span>
            </li>
          ))}
        </ul>

        <div className="flex flex-col sm:flex-row gap-2">
          <Button
            size="lg"
            className="h-11 px-6 gap-2"
            onClick={async () => {
              if (await copyBackupCodes(backupCodes.join("\n"))) {
                setCodesCopiedEver(true);
              }
            }}
          >
            {codeCopyFeedback ? (
              <Check className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Copy className="h-4 w-4" aria-hidden="true" />
            )}
            {codeCopyFeedback ? "Copied to clipboard" : "Copy all codes"}
          </Button>
          <CopiedAnnouncement copied={codeCopyFeedback} noun="backup codes" />
          <Button
            variant="outline"
            size="lg"
            className="h-11 px-6 gap-2"
            onClick={downloadBackupCodes}
          >
            {codesDownloaded ? (
              <Check className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Download className="h-4 w-4" aria-hidden="true" />
            )}
            {codesDownloaded ? "Downloaded" : "Download as .txt"}
          </Button>
        </div>

        <div
          className="text-sm text-muted-foreground"
          role="status"
          aria-live="polite"
        >
          {codesSaved
            ? "Stored somewhere safe? You can close this now."
            : "Copy or download the codes to continue."}
        </div>

        <div className="border-t border-border/50 pt-4">
          <Button
            variant={codesSaved ? "default" : "outline"}
            onClick={() => {
              setBackupCodes([]);
              setCodesCopiedEver(false);
              setCodesDownloaded(false);
            }}
            className="gap-2"
          >
            {codesSaved ? "Done, I saved them" : "Skip, I will not save them"}
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      {/* Sign-in summary: one line of prose, not a row of stat cards. */}
      <p className="text-sm text-muted-foreground leading-relaxed">
        {hasPassword
          ? "Your account is protected by a password"
          : "You sign in through an outside provider, with no password on file"}
        {appActive
          ? " and a code from your authenticator app."
          : emailActive
            ? " and a code emailed to you at sign-in."
            : hasPassword
              ? ". Two-step verification is off, so a stolen password is enough to get in."
              : "."}
      </p>

      {/* ─────────── Password ─────────── */}
      <Section
        title="Password"
        blurb={
          hasPassword
            ? "Used every time you sign in."
            : "Not set. You signed up with an outside provider, so add one if you also want to sign in with a password."
        }
      >
        <Card className="border-border/50 bg-card/50">
          <CardContent className="flex items-center justify-between gap-4 py-5">
            <p className="text-sm text-foreground">
              {hasPassword
                ? "Your password is set."
                : "No password on file yet."}
            </p>
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 shrink-0"
              onClick={() => setPasswordDialogOpen(true)}
            >
              {hasPassword ? "Change password" : "Set a password"}
            </Button>
          </CardContent>
        </Card>
      </Section>

      {/* ─────────── Two-step verification ─────────── */}
      <Section
        title="Two-step verification"
        blurb={
          totpEnabled
            ? "A second code is required after your password."
            : "Ask for a second code after the password, so a leaked password is not enough."
        }
        aside={
          <StatusPill tone={totpEnabled ? "on" : "off"}>
            {appActive
              ? "Authenticator app"
              : emailActive
                ? "Email codes"
                : "Off"}
          </StatusPill>
        }
      >
        <div className="flex flex-col gap-3">
          {/* ── Authenticator app ── */}
          <div
            className={cn(
              "rounded-xl border p-4 sm:p-5 flex flex-col gap-4",
              appActive
                ? "border-primary/25 bg-primary/4"
                : "border-border bg-card",
            )}
          >
            <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground">
                  Authenticator app
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  A rotating 6-digit code from Google Authenticator, Authy,
                  1Password, or similar. Works offline.
                </p>
              </div>
              {appActive ? (
                <StatusPill tone="on">Active</StatusPill>
              ) : (
                (!totpEnabled || emailActive) && (
                  <Button
                    size="sm"
                    className="h-8 gap-1.5 shrink-0"
                    disabled={emailActive || startingSetup}
                    onClick={startAuthenticatorSetup}
                  >
                    {startingSetup && (
                      <Loader2
                        className="h-4 w-4 animate-spin"
                        aria-hidden="true"
                      />
                    )}
                    {emailActive
                      ? "Turn off email codes first"
                      : "Set up authenticator app"}
                  </Button>
                )
              )}
            </div>

            {/* App 2FA active: backup codes + turn off */}
            {appActive && (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">
                      Backup codes
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {backupCodesRemaining === null ? (
                        backupCodesCheckFailed ? (
                          "Could not check how many are left. Reload the page to check again."
                        ) : (
                          "Checking how many are left..."
                        )
                      ) : (
                        <>
                          {backupCodesRemaining} of {BACKUP_CODE_SET_SIZE} left.
                          {backupCodesRemaining <= 2 && backupCodesRemaining > 0
                            ? " Generate a new set soon."
                            : ""}
                          {backupCodesRemaining === 0
                            ? " Generate a new set to keep a way back in."
                            : ""}
                        </>
                      )}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1.5"
                    onClick={() => setRegenerateOpen(true)}
                  >
                    New codes
                  </Button>
                </div>

                <button
                  type="button"
                  onClick={() => setTurnOffMethod("app")}
                  className="self-start -my-1.5 py-1.5 text-sm text-muted-foreground hover:text-destructive underline underline-offset-4 transition-colors rounded-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Turn off the authenticator app
                </button>
              </>
            )}
          </div>

          {/* ── Email codes ── */}
          <div
            className={cn(
              "rounded-xl border p-4 sm:p-5 flex flex-col gap-4",
              emailActive
                ? "border-primary/25 bg-primary/4"
                : "border-border bg-card",
            )}
          >
            <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground">
                  Email codes
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  We send a 6-digit code to {user?.email || "your inbox"} at
                  every sign-in. Simpler to set up, but only as safe as your
                  email account.
                </p>
              </div>
              {emailActive ? (
                <StatusPill tone="on">Active</StatusPill>
              ) : (
                (!totpEnabled || appActive) && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 gap-1.5 shrink-0"
                    disabled={appActive}
                    onClick={() => {
                      if (appActive) return;
                      setEnableEmailOpen(true);
                    }}
                  >
                    {appActive
                      ? "Turn off the authenticator app first"
                      : "Turn on email codes"}
                  </Button>
                )
              )}
            </div>

            {emailActive && (
              <button
                type="button"
                onClick={() => setTurnOffMethod("email")}
                className="self-start -my-1.5 py-1.5 text-sm text-muted-foreground hover:text-destructive underline underline-offset-4 transition-colors rounded-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
              >
                Turn off email codes
              </button>
            )}
          </div>
        </div>
      </Section>

      {/* ─────────── Active sessions ─────────── */}
      {/* "Sign out everywhere" used to be its own danger-zone panel at the
          very bottom of this tab, below trusted devices and sign-in alerts.
          It is a session action, so it belongs on the section that lists
          sessions: someone who has just spotted a device they do not
          recognize is looking here, not 600px further down. The destructive
          outline plus the confirmation dialog still mark it as the drastic
          option. */}
      <Section
        title="Active sessions"
        blurb="Every device currently signed in. If you don't recognize one, sign it out. Signing out everywhere ends this session too."
        aside={
          <Button
            variant="outline"
            size="sm"
            className="h-9 gap-1.5 shrink-0 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() => setShowLogoutModal(true)}
          >
            <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
            Sign out everywhere
          </Button>
        }
      >
        {sessionsLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Loading sessions...
          </div>
        ) : sessionsError ? (
          <p className="text-sm text-muted-foreground">{sessionsError}</p>
        ) : sessions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No active sessions found.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {sessions.map((s) => (
              <li
                key={s.id}
                className="rounded-xl border border-border bg-card p-4 flex flex-wrap items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-foreground">
                      {s.device}
                    </span>
                    {s.isCurrent && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary px-2 py-0.5 text-[11px] font-medium">
                        This device
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {/* Prefer the captured IPv4 (more actionable); fall back to
                        the connection IP so a failed or absent capture never
                        leaves this blank. */}
                    {s.ipv4Address || s.ipAddress
                      ? `${s.ipv4Address || s.ipAddress} · `
                      : ""}
                    Signed in {formatDateTime(s.createdAt)}
                  </p>
                </div>
                {!s.isCurrent && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      confirm({
                        title: "Sign out this session?",
                        description: `Whoever is signed in on ${s.device} is signed out straight away and has to sign in again.`,
                        confirmLabel: "Sign out",
                        danger: true,
                        onConfirm: () => handleRevokeSession(s.id),
                      })
                    }
                    disabled={revokingSessionId === s.id}
                    className="text-muted-foreground hover:text-destructive h-8 gap-1.5 shrink-0"
                    aria-label={`Sign out the session on ${s.device}`}
                  >
                    {revokingSessionId === s.id ? (
                      <Loader2
                        className="h-3.5 w-3.5 animate-spin"
                        aria-hidden="true"
                      />
                    ) : (
                      <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                    )}
                    Sign out
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* ─────────── Trusted devices ─────────── */}
      {(devicesLoading || trustedDevices.length > 0) && (
        <Section
          title="Trusted devices"
          blurb="Devices that skip the two-step code because they already proved it once. Remove one to require the code again next time."
        >
          {devicesLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Loading trusted devices...
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
              {trustedDevices.map((d) => (
                <li
                  key={d.id}
                  className="rounded-xl border border-border bg-card p-4 flex flex-wrap items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-foreground">
                        {d.deviceName || d.device}
                      </span>
                      {d.isCurrent && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary px-2 py-0.5 text-[11px] font-medium">
                          This device
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {d.ipAddress ? `${d.ipAddress} · ` : ""}
                      Last used {formatDateTime(d.lastUsedAt)}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      confirm({
                        title: "Remove this trusted device?",
                        description: `${d.deviceName || d.device} has to pass two-factor again the next time it signs in.`,
                        confirmLabel: "Remove device",
                        danger: true,
                        onConfirm: () => handleRevokeDevice(d.id),
                      })
                    }
                    disabled={revokingDeviceId === d.id}
                    className="text-muted-foreground hover:text-destructive h-8 gap-1.5 shrink-0"
                    aria-label={`Remove trusted device ${d.deviceName || d.device}`}
                  >
                    {revokingDeviceId === d.id ? (
                      <Loader2
                        className="h-3.5 w-3.5 animate-spin"
                        aria-hidden="true"
                      />
                    ) : (
                      <ShieldOff className="h-3.5 w-3.5" aria-hidden="true" />
                    )}
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}

      {/* ─────────── Sign-in alerts ───────────
          A pointer to another tab, not a setting. It used to be a full
          Section plus a Card, which gave a signpost the same visual weight
          as password and 2FA and added a fifth identical bordered box to the
          stack. One line of prose with an inline link says the same thing. */}
      <p className="text-sm text-muted-foreground leading-relaxed border-t border-border/50 pt-6">
        Emails about new sign-ins, password changes and revoked sessions are set
        up on the{" "}
        <a
          href={`${ROUTES.PROFILE}?tab=notifications`}
          onClick={(e) => {
            if (!e.ctrlKey && !e.metaKey) {
              e.preventDefault();
              onTabChange("notifications");
            }
          }}
          className="inline-flex items-center gap-0.5 font-medium text-primary underline underline-offset-2 rounded-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
        >
          Notifications tab
          <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
        </a>
        .
      </p>

      {passwordDialogOpen && (
        <PasswordDialog
          hasPassword={hasPassword}
          onClose={() => setPasswordDialogOpen(false)}
          onSaved={() => {
            // A first password turns an OAuth-only account into one with a
            // hash. Without this the tab keeps saying no password is on file,
            // and the next change leaves out the current-password field the
            // server now asks for.
            if (!hasPassword) onUserPatch?.({ hasPassword: true });
            setSuccess(hasPassword ? "Password updated." : "Password set.");
          }}
        />
      )}
      {regenerateOpen && (
        <RegenerateBackupCodesDialog
          onClose={() => setRegenerateOpen(false)}
          returnFocusRef={backupPanelRef}
          onIssued={(codes) => {
            setRegenerateOpen(false);
            showIssuedCodes(codes);
            setSuccess("New backup codes generated.");
          }}
        />
      )}
      {totpSetup && (
        <AuthenticatorSetupDialog
          setup={totpSetup}
          onClose={resetEnrolment}
          returnFocusRef={backupPanelRef}
          onEnabled={(codes) => {
            resetEnrolment();
            setTotpEnabled(true);
            setTwoFactorMethod("app");
            showIssuedCodes(codes);
            // totpEnabled/twoFactorMethod are part of MeResponse, so the
            // app-wide useAuth() cache has to hear about the change too.
            refreshAuthCache();
            setSuccess("Authenticator app is on. Save your backup codes.");
          }}
        />
      )}
      {enableEmailOpen && (
        <EnableEmailCodesDialog
          email={user?.email}
          onClose={() => setEnableEmailOpen(false)}
          onEnabled={() => {
            setEnableEmailOpen(false);
            setTotpEnabled(true);
            setTwoFactorMethod("email");
            refreshAuthCache();
            setSuccess("Email codes are on.");
          }}
        />
      )}
      {turnOffMethod && (
        <TurnOffTwoFactorDialog
          method={turnOffMethod}
          onClose={() => setTurnOffMethod(null)}
          onTurnedOff={() => {
            const method = turnOffMethod;
            setTurnOffMethod(null);
            setTotpEnabled(false);
            setTwoFactorMethod(null);
            refreshAuthCache();
            setSuccess(
              method === "app"
                ? "Authenticator app turned off. Your password is now the only thing protecting this account."
                : "Email codes turned off. Your password is now the only thing protecting this account.",
            );
          }}
        />
      )}

      {/* Sign out everywhere confirmation */}
      <ConfirmDialog
        open={showLogoutModal}
        title="Sign out everywhere?"
        description={
          <>
            This ends every session for {user?.email || "your account"},
            including the one you are using now. You will land on the sign-in
            page and need your password again on every device.
          </>
        }
        confirmLabel="Sign out everywhere"
        danger
        error={logoutError}
        onConfirm={handleForceLogout}
        onCancel={() => {
          setShowLogoutModal(false);
          setLogoutError(null);
        }}
      />
      {confirmDialog}
    </div>
  );
}
