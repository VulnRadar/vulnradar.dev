"use client";

import { useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { InlineAlert } from "@/components/shared/inline-alert";

/**
 * Linking a sign-in provider adds a permanent way into the account, so it asks
 * who is at the keyboard first: an attacker holding a stolen session would
 * otherwise attach their own Google account and keep access after the owner
 * resets the password.
 *
 * A navigation cannot carry a password, so the start routes take it from a POST
 * and answer with the URL to go to.
 */

export type ProviderStartResult = { url: string } | { error: string };

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

export async function requestProviderStart(
  startUrl: string,
  hasPassword: boolean,
  password: string,
): Promise<ProviderStartResult> {
  let res: Response;
  try {
    res = await fetch(startUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Exactly as typed: the server compares it with the stored hash as is.
      body: JSON.stringify(hasPassword ? { password } : {}),
    });
  } catch {
    return {
      error:
        "We could not reach the server. Check your connection and try again.",
    };
  }

  const data = (await res.json().catch(() => ({}))) as {
    url?: unknown;
    error?: unknown;
  };
  if (res.ok && typeof data.url === "string" && isHttpsUrl(data.url)) {
    return { url: data.url };
  }
  return {
    error:
      typeof data.error === "string" && data.error
        ? data.error
        : "We could not start that connection. Try again.",
  };
}

/** The dialog's body, apart so it can render without the portal. */
export function ProviderReauthFields({
  label,
  hasPassword,
  password,
  onPasswordChange,
  error,
}: {
  label: string;
  hasPassword: boolean;
  password: string;
  onPasswordChange: (value: string) => void;
  error: string | null;
}) {
  return (
    <div className="flex flex-col gap-4">
      {hasPassword ? (
        <div className="flex flex-col gap-2">
          <Label htmlFor="provider-reauth-password">Current password</Label>
          <Input
            id="provider-reauth-password"
            type="password"
            autoComplete="current-password"
            autoFocus
            value={password}
            onChange={(e) => onPasswordChange(e.target.value)}
            className="h-10"
          />
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          You will go to {label} to approve this.
        </p>
      )}
      {error && <InlineAlert tone="error">{error}</InlineAlert>}
    </div>
  );
}

export function ProviderReauthDialog({
  label,
  startUrl,
  hasPassword,
  onStarted,
  onClose,
}: {
  label: string;
  startUrl: string;
  hasPassword: boolean;
  /** Runs once the route has agreed, just before the page navigates away. */
  onStarted?: () => void;
  onClose: () => void;
}) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || (hasPassword && !password)) return;
    setBusy(true);
    setError(null);

    const result = await requestProviderStart(startUrl, hasPassword, password);
    if ("error" in result) {
      setError(result.error);
      setBusy(false);
      return;
    }
    onStarted?.();
    // A full document navigation on purpose, and busy stays on until it
    // happens: this is the provider's consent page, not an app route.
    window.location.href = result.url;
  };

  return (
    <Dialog
      open
      onOpenChange={(isOpen) => {
        if (!isOpen && !busy) onClose();
      }}
    >
      <DialogContent variant="shell" size="sm">
        <DialogHeader>
          <DialogTitle>Connect {label}</DialogTitle>
          <DialogDescription>
            {hasPassword
              ? `This adds another way to sign in, so confirm your password before going to ${label}.`
              : `This adds another way to sign in to this account.`}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="contents">
          <DialogBody>
            <ProviderReauthFields
              label={label}
              hasPassword={hasPassword}
              password={password}
              onPasswordChange={setPassword}
              error={error}
            />
          </DialogBody>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={onClose}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={busy || (hasPassword && !password)}
              className="gap-2"
            >
              {busy && (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              )}
              Continue
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
