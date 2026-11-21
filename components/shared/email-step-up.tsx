"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { InlineAlert } from "@/components/shared/inline-alert";
import { clearAuthCache } from "@/components/providers/auth-provider";
import { API, ROUTES } from "@/lib/config/client-constants";
import { STEP_UP_WINDOW } from "@/lib/auth/step-up-window";

/**
 * "Confirm it is you" for an account with no password.
 *
 * Every security change asks for the current password (lib/auth/reauth.ts).
 * An account created through Google, GitHub or Discord has none, and its
 * session alone used to be accepted instead, so a stolen session cookie could
 * change the email, set a password and switch two-step off. Such an account
 * now proves it is at the keyboard with a code mailed to its address: this
 * component asks for one, takes it back, and the server answers with a
 * ten-minute step-up cookie that the gated request then carries by itself.
 *
 * Put it where the password field would be, for `hasPassword === false`, and
 * hold Save until `onReady` fires, or let it go at once when
 * `emailConfigured` is false. On a server that cannot send mail there is no
 * code: it offers a fresh sign-in instead, which the gate accepts for ten
 * minutes, and only the server can tell whether this session is that fresh.
 * `stepUpCanSave` is that rule in one place.
 *
 * `mode="second-factor"` is the same send and verify for an account that has
 * a password and signs in with email codes: in front of an update or an
 * impersonation the mailed code is its second factor
 * (lib/auth/staff-step-up.ts), not a stand-in for the password. A fresh
 * sign-in is no second factor, so that mode never offers one: on a server
 * that cannot send mail it says so and stays not ready.
 */

export type StepUpMode = "no-password" | "second-factor";

export function stepUpCanSave(
  emailConfigured: boolean,
  stepUpDone: boolean,
): boolean {
  return stepUpDone || !emailConfigured;
}

const NETWORK_ERROR =
  "We could not reach the server. Check your connection and try again.";

export type StepUpCodeResult =
  | { ok: true; maskedEmail: string | null }
  | { ok: false; error: string; emailConfigured?: false };

/** POST { purpose: "reauth" }: mail a step-up code to the address on file. */
export async function requestStepUpCode(): Promise<StepUpCodeResult> {
  try {
    const res = await fetch(API.AUTH.TWO_FA.EMAIL_SEND, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ purpose: "reauth" }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      maskedEmail?: unknown;
      error?: unknown;
      emailConfigured?: unknown;
    };
    if (res.ok) {
      return {
        ok: true,
        maskedEmail:
          typeof data.maskedEmail === "string" ? data.maskedEmail : null,
      };
    }
    const error =
      typeof data.error === "string" && data.error
        ? data.error
        : "We could not send a code. Try again in a moment.";
    return data.emailConfigured === false
      ? { ok: false, error, emailConfigured: false }
      : { ok: false, error };
  } catch {
    return { ok: false, error: NETWORK_ERROR };
  }
}

/** POST { purpose: "reauth", code }: the message to show, or null once confirmed. */
export async function confirmStepUpCode(code: string): Promise<string | null> {
  try {
    const res = await fetch(API.AUTH.TWO_FA.VERIFY, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ purpose: "reauth", code }),
    });
    if (res.ok) return null;
    const data = (await res.json().catch(() => ({}))) as { error?: unknown };
    return typeof data.error === "string" && data.error
      ? data.error
      : "That code did not match. Check the email and try again.";
  } catch {
    return NETWORK_ERROR;
  }
}

/** Sign out, then back to this page through the sign-in screen. */
async function signInAgain(): Promise<void> {
  await fetch(API.AUTH.LOGOUT, { method: "POST" }).catch(() => undefined);
  clearAuthCache();
  const here = `${window.location.pathname}${window.location.search}`;
  // A full document load, not router.push: everything in memory belonged to
  // the session that was just ended. replace, so Back does not return to it.
  window.location.replace(
    `${ROUTES.LOGIN}?redirect=${encodeURIComponent(here)}`,
  );
}

export type StepUpPhase = "start" | "sent" | "done" | "sign-in";

export interface EmailStepUpViewProps {
  phase: StepUpPhase;
  /** Which account this is for; only the explanation differs. */
  mode?: StepUpMode;
  idPrefix: string;
  code: string;
  maskedEmail: string | null;
  busy: boolean;
  error: string | null;
  onSend: () => void;
  onCodeChange: (code: string) => void;
  onConfirm: () => void;
  onSignInAgain: () => void;
}

/** The markup for each phase, apart from the state so each can be rendered. */
export function EmailStepUpView({
  phase,
  mode = "no-password",
  idPrefix,
  code,
  maskedEmail,
  busy,
  error,
  onSend,
  onCodeChange,
  onConfirm,
  onSignInAgain,
}: EmailStepUpViewProps) {
  const errorId = `${idPrefix}-error`;
  const spinner = busy ? (
    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
  ) : null;

  if (phase === "done") {
    return (
      <InlineAlert tone="success" live="polite">
        Confirmed. You have {STEP_UP_WINDOW} to finish.
      </InlineAlert>
    );
  }

  if (phase === "sign-in") {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          Your account has no password, and this server cannot send email, so
          confirm it is you by signing in again. Then come back and do this
          within {STEP_UP_WINDOW}.
        </p>
        <Button
          type="button"
          variant="outline"
          className="self-start"
          onClick={onSignInAgain}
        >
          Sign in again
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {phase === "start" ? (
        <>
          <p className="text-sm text-muted-foreground">
            {mode === "second-factor"
              ? "Your account uses email codes for two-step sign-in, so confirm this with a 6-digit code we email to you."
              : "Your account has no password, so confirm it is you with a 6-digit code we email to you."}
          </p>
          <Button
            type="button"
            variant="outline"
            className="self-start gap-2"
            disabled={busy}
            onClick={onSend}
          >
            {spinner}
            {"Email me a code"}
          </Button>
        </>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            We sent a 6-digit code to {maskedEmail ?? "your email address"}. It
            works for {STEP_UP_WINDOW}.
          </p>
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${idPrefix}-code`}>6-digit code</Label>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                id={`${idPrefix}-code`}
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                placeholder="000000"
                autoFocus
                value={code}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? errorId : undefined}
                onChange={(e) =>
                  onCodeChange(e.target.value.replace(/\D/g, "").slice(0, 6))
                }
                // Enter confirms the code here rather than submitting the
                // dialog around it, whose Save is still waiting on this.
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  e.preventDefault();
                  e.stopPropagation();
                  if (code.length === 6 && !busy) onConfirm();
                }}
                className="h-10 w-[180px] text-center text-lg tracking-[0.3em] font-mono"
              />
              <Button
                type="button"
                className="gap-2"
                disabled={busy || code.length !== 6}
                onClick={onConfirm}
              >
                {spinner}
                {"Confirm"}
              </Button>
            </div>
          </div>
          <button
            type="button"
            onClick={onSend}
            disabled={busy}
            className="self-start -my-1.5 py-1.5 text-sm text-muted-foreground hover:text-foreground underline underline-offset-4 transition-colors rounded-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
          >
            Send a new code
          </button>
        </>
      )}
      {error && (
        <div id={errorId}>
          <InlineAlert tone="error">{error}</InlineAlert>
        </div>
      )}
    </div>
  );
}

export function EmailStepUp({
  emailConfigured = true,
  onReady,
  idPrefix = "step-up",
  mode = "no-password",
}: {
  /** False when the server cannot send mail (GET API.CONFIG_CLIENT). */
  emailConfigured?: boolean;
  /**
   * Fires when the code is confirmed, or when the server turns out not to
   * send mail after all, so a fresh sign-in is the only step-up there is.
   */
  onReady: () => void;
  /** Keeps ids unique when two of these could be on one page. */
  idPrefix?: string;
  /** "second-factor" for a password account that signs in with email codes. */
  mode?: StepUpMode;
}) {
  const secondFactor = mode === "second-factor";
  const [phase, setPhase] = useState<StepUpPhase>(
    emailConfigured || secondFactor ? "start" : "sign-in",
  );
  const [code, setCode] = useState("");
  const [maskedEmail, setMaskedEmail] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    setBusy(true);
    setError(null);
    const result = await requestStepUpCode();
    setBusy(false);
    if (result.ok) {
      setMaskedEmail(result.maskedEmail);
      setCode("");
      setPhase("sent");
      return;
    }
    // The config said mail works and the server says it does not: the
    // server is the one that knows. A second factor has no fallback, so the
    // refusal is shown and nothing is ready.
    if (result.emailConfigured === false && !secondFactor) {
      setPhase("sign-in");
      onReady();
      return;
    }
    setError(result.error);
  }

  async function confirm() {
    setBusy(true);
    setError(null);
    const problem = await confirmStepUpCode(code);
    setBusy(false);
    if (problem) {
      setError(problem);
      return;
    }
    setPhase("done");
    onReady();
  }

  return (
    <EmailStepUpView
      phase={phase}
      mode={mode}
      idPrefix={idPrefix}
      code={code}
      maskedEmail={maskedEmail}
      busy={busy}
      error={error}
      onSend={() => void send()}
      onCodeChange={setCode}
      onConfirm={() => void confirm()}
      onSignInAgain={() => void signInAgain()}
    />
  );
}
