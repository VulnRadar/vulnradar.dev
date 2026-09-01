"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Check, Eye, EyeOff, Loader2, X } from "lucide-react";
import { AuthLayout } from "@/components/auth/auth-layout";
import {
  AuthAlert,
  AuthHeading,
  AuthOutcome,
  authFieldClass,
  authFocusRing,
  PasswordStrengthMeter,
} from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  analyzePassword,
  checkPasswordRequirements,
  passwordRequirementsMet,
} from "@/lib/auth/password-strength";
import {
  API,
  APP_NAME,
  PASSWORD_MIN_LENGTH,
  ROUTES,
} from "@/lib/config/client-constants";
import { cn } from "@/lib/ui/utils";
import { transitions } from "@/lib/ui/animations";

/**
 * Acceptance page for a staff invite (AUDIT-012#authz-10).
 *
 * app/api/v3/admin/staff-invites/route.ts has always emailed
 * `${APP_URL}/staff-invite/${token}`, and the accept endpoints behind it
 * (app/api/v3/auth/staff-invite/[token]/route.ts, GET to validate and POST to
 * accept) have always been implemented, but no page ever existed at that URL:
 * every invite an admin sent was a 404 and the only way to add staff was for
 * an admin to edit the role by hand. This is that page, and it is the accept
 * endpoints' only caller.
 *
 * Deliberately self-contained rather than split into components/auth/: the
 * whole flow is one fetch, one form and three terminal states, and the
 * password half only renders for an invitee who has no account yet.
 */

interface InviteDetails {
  email: string;
  role: string;
  roleLabel: string;
  /** True when this email already has an account, so accepting is a
   *  promotion and no password is collected. */
  hasAccount: boolean;
}

export default function StaffInvitePage() {
  const params = useParams();
  const token = typeof params.token === "string" ? params.token : "";

  const [invite, setInvite] = useState<InviteDetails | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [accepted, setAccepted] = useState<{ createdAccount: boolean } | null>(
    null,
  );

  // GET validates the token and returns the invited email and role, POST
  // accepts it. API.AUTH.STAFF_INVITE interpolates its argument raw, same as
  // the other parameterised entries in that block, so the token is encoded
  // here.
  const acceptUrl = API.AUTH.STAFF_INVITE(encodeURIComponent(token));

  useEffect(() => {
    if (!token) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- terminal state for a route that cannot be reached without a token segment
      setLoadError("This invite link is missing its token.");
      setLoading(false);
      return;
    }
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(acceptUrl);
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setLoadError(
            data.error || "This invite is no longer valid. Ask for a new one.",
          );
          return;
        }
        setInvite(data as InviteDetails);
      } catch {
        if (!cancelled) {
          setLoadError(
            "Could not reach the server to check this invite. Try again in a moment.",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [token, acceptUrl]);

  const needsPassword = !!invite && !invite.hasAccount;

  // The server checks the password against the invited email and the name
  // submitted with it, so the checklist here can run the full set rather than
  // omitting the two personal-info rules the way the reset-password screen
  // has to (that screen only holds a token).
  const passwordContext = { email: invite?.email, name: name.trim() };
  const analysis = analyzePassword(password);
  const weakHint =
    password && analysis.score < 3
      ? analysis.feedback.warnings[0] || analysis.feedback.suggestions[0]
      : undefined;
  const requirementsMet = passwordRequirementsMet(
    checkPasswordRequirements(password, passwordContext),
  );
  const confirmMatches = confirm.length > 0 && confirm === password;

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setSubmitError("");
      if (needsPassword) {
        if (password !== confirm) {
          setSubmitError(
            "The two passwords are different. Retype the second one.",
          );
          return;
        }
        if (!requirementsMet) {
          setSubmitError(
            "That password does not meet every requirement below yet. Check the list under the password field.",
          );
          return;
        }
      }
      setSubmitting(true);
      try {
        const res = await fetch(acceptUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            needsPassword ? { password, name: name.trim() } : {},
          ),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setSubmitError(data.error || "This invite could not be accepted.");
          return;
        }
        setAccepted({ createdAccount: !!data.createdAccount });
      } catch {
        setSubmitError(
          "Could not reach the server. Check your connection, then retry.",
        );
      } finally {
        setSubmitting(false);
      }
    },
    [acceptUrl, confirm, name, needsPassword, password, requirementsMet],
  );

  if (loading) {
    return (
      <AuthLayout>
        <div className="border-l-2 border-border pl-4" aria-busy="true">
          <div className="flex items-center gap-2.5">
            <Loader2
              className="h-4 w-4 animate-spin text-muted-foreground shrink-0"
              aria-hidden="true"
            />
            <h1 className="text-2xl font-semibold tracking-tight">
              One moment
            </h1>
          </div>
          <p className="text-sm text-muted-foreground mt-2" role="status">
            Checking this invite
          </p>
        </div>
      </AuthLayout>
    );
  }

  if (accepted) {
    return (
      <AuthLayout>
        <AuthOutcome
          tone="positive"
          title={accepted.createdAccount ? "Account created" : "Role updated"}
          actions={
            <Button
              asChild
              size="lg"
              className={cn("h-11 w-full", authFocusRing)}
            >
              <Link href={ROUTES.LOGIN}>Sign in</Link>
            </Button>
          }
          footnote={`Staff accounts on ${APP_NAME} can be required to have two-factor authentication switched on. If sign-in asks you to set it up, that is why.`}
        >
          <p>
            {invite?.email} now has the {invite?.roleLabel} role. Sign in to
            reach the admin panel.
          </p>
        </AuthOutcome>
      </AuthLayout>
    );
  }

  if (loadError || !invite) {
    return (
      <AuthLayout>
        <AuthOutcome
          tone="negative"
          title="This invite cannot be used"
          actions={
            <Button
              asChild
              size="lg"
              variant="outline"
              className={cn("h-11 w-full border-border/60", authFocusRing)}
            >
              <Link href={ROUTES.LOGIN}>Go to sign in</Link>
            </Button>
          }
          footnote="Invites expire, and each one can be accepted only once. Ask whoever sent it to issue a fresh one."
        >
          <p>{loadError}</p>
        </AuthOutcome>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <AuthHeading
        title="Accept your staff invite"
        description={
          <>
            You have been invited to {APP_NAME} as{" "}
            <span className="font-medium text-foreground">
              {invite.roleLabel}
            </span>
            , for{" "}
            <span className="font-medium text-foreground">{invite.email}</span>.{" "}
            {needsPassword
              ? "There is no account on that address yet, so pick a password and one gets created."
              : "That address already has an account, so accepting just adds the role to it."}
          </>
        }
      />

      <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        {needsPassword && (
          <>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="name">Your name</Label>
              <Input
                id="name"
                name="name"
                type="text"
                autoComplete="name"
                placeholder="Shown beside your actions in the admin panel"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
                className={authFieldClass}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Input
                  id="password"
                  name="password"
                  type={showPass ? "text" : "password"}
                  autoComplete="new-password"
                  placeholder={`At least ${PASSWORD_MIN_LENGTH} characters`}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={PASSWORD_MIN_LENGTH}
                  aria-describedby={password ? "password-strength" : undefined}
                  className={cn(authFieldClass, "pr-11")}
                />
                <button
                  type="button"
                  onClick={() => setShowPass(!showPass)}
                  className={cn(
                    "absolute right-1 top-1/2 -translate-y-1/2 h-9 w-9 rounded-md",
                    "flex items-center justify-center text-muted-foreground hover:text-foreground",
                    transitions.colors,
                    authFocusRing,
                  )}
                  aria-label={showPass ? "Hide password" : "Show password"}
                  aria-pressed={showPass}
                >
                  {showPass ? (
                    <EyeOff className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    <Eye className="h-4 w-4" aria-hidden="true" />
                  )}
                </button>
              </div>
              {password && (
                <PasswordStrengthMeter
                  id="password-strength"
                  password={password}
                  level={analysis.strength.level}
                  label={analysis.strength.label}
                  hint={weakHint}
                  context={passwordContext}
                />
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="confirm">Retype password</Label>
              <Input
                id="confirm"
                name="confirm"
                type={showPass ? "text" : "password"}
                autoComplete="new-password"
                placeholder="The same password again"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                aria-describedby="confirm-status"
                className={authFieldClass}
              />
              <p
                id="confirm-status"
                aria-live="polite"
                className={cn(
                  "text-xs flex items-center gap-1.5 min-h-4",
                  confirmMatches ? "text-primary" : "text-muted-foreground",
                )}
              >
                {confirm.length === 0 ? null : confirmMatches ? (
                  <>
                    <Check className="h-3 w-3 shrink-0" aria-hidden="true" />
                    Both passwords match.
                  </>
                ) : (
                  <>
                    <X className="h-3 w-3 shrink-0" aria-hidden="true" />
                    Not the same yet.
                  </>
                )}
              </p>
            </div>
          </>
        )}

        {submitError && <AuthAlert>{submitError}</AuthAlert>}

        <Button
          type="submit"
          size="lg"
          disabled={
            submitting ||
            (needsPassword &&
              (!password ||
                !confirm ||
                password !== confirm ||
                !requirementsMet))
          }
          className={cn("h-11 w-full mt-1", authFocusRing)}
        >
          {submitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Accepting the invite
            </>
          ) : needsPassword ? (
            "Create the account"
          ) : (
            "Accept the invite"
          )}
        </Button>
      </form>
    </AuthLayout>
  );
}
