"use client";

import { FaGithub } from "react-icons/fa";
import { FcGoogle } from "react-icons/fc";
import { Button } from "@/components/ui/button";
import { API } from "@/lib/config/client-constants";
import { cn } from "@/lib/ui/utils";
import { authFocusRing } from "@/components/auth/auth-shell";
import { useOAuthProviders } from "@/lib/hooks/use-oauth-providers";

function DiscordIcon() {
  return (
    <svg
      className="h-4 w-4"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
    </svg>
  );
}

interface OAuthButtonsProps {
  /** "Sign in" on the login page, "Sign up" on the signup page. */
  actionLabel: string;
  /**
   * Which page this is -- threaded through to the OAuth start route as
   * `?intent=`, signed into the state, and enforced by the callback:
   * "login" only ever signs in to an EXISTING account (no match means an
   * error telling the user to sign up first, never a new account),
   * "signup" is the only path allowed to create one on no match.
   */
  intent: "login" | "signup";
}

type ConfiguredProvider = {
  id: "google" | "github" | "discord";
  name: string;
  icon: React.ReactNode;
};

function ProviderButton({
  provider,
  label,
  showLabel,
  onStart,
}: {
  provider: ConfiguredProvider;
  /** Full sentence, e.g. "Sign in with GitHub". Always the accessible name,
   *  even when the button only shows the provider's name. */
  label: string;
  showLabel: boolean;
  onStart: (id: string) => void;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="lg"
      aria-label={label}
      className={cn("h-11 w-full border-border/60 gap-2 px-3", authFocusRing)}
      onClick={() => onStart(provider.id)}
    >
      {provider.icon}
      {showLabel ? label : provider.name}
    </Button>
  );
}

/**
 * Provider sign-in/sign-up buttons for Google, GitHub, and Discord.
 * Each one is individually shown only once its client id/secret is
 * configured server-side (see /api/v3/auth/oauth/info and
 * lib/auth/oauth-providers.ts) -- same "invisible until configured"
 * pattern as the Turnstile widget. Renders nothing at all if none of the
 * three are set up, so a self-hosted instance with no OAuth apps
 * registered sees exactly the password form and nothing else.
 */
export function OAuthButtons({ actionLabel, intent }: OAuthButtonsProps) {
  const providers = useOAuthProviders();

  const configured: ConfiguredProvider[] = [];
  if (providers.google)
    configured.push({
      id: "google",
      name: "Google",
      icon: <FcGoogle className="h-4 w-4" aria-hidden="true" />,
    });
  if (providers.github)
    configured.push({
      id: "github",
      name: "GitHub",
      icon: <FaGithub className="h-4 w-4" aria-hidden="true" />,
    });
  if (providers.discord)
    configured.push({ id: "discord", name: "Discord", icon: <DiscordIcon /> });

  if (configured.length === 0) return null;

  const startUrl = (provider: string) =>
    `${API.AUTH.OAUTH_START(provider)}?intent=${intent}`;
  const start = (id: string) => {
    window.location.href = startUrl(id);
  };

  // With all three configured this was three identical full-width bars, the
  // one place the form column read templated. The first keeps the full
  // sentence and the other two pair off underneath it. Every button is still
  // h-11 with the outline border, so neither the 44px target nor the visible
  // control border moves.
  const lead = configured.length === 3 ? configured[0] : null;
  const rest = lead ? configured.slice(1) : configured;

  return (
    <>
      <div className="relative my-1">
        <span className="absolute inset-0 flex items-center" aria-hidden="true">
          <span className="w-full border-t border-border/60" />
        </span>
        <span className="relative flex justify-center">
          <span className="bg-background px-2.5 text-xs text-muted-foreground">
            or
          </span>
        </span>
      </div>

      {lead && (
        <ProviderButton
          provider={lead}
          label={`${actionLabel} with ${lead.name}`}
          showLabel
          onStart={start}
        />
      )}

      {rest.length > 1 ? (
        <div className="grid grid-cols-2 gap-2">
          {rest.map((p) => (
            <ProviderButton
              key={p.id}
              provider={p}
              label={`${actionLabel} with ${p.name}`}
              showLabel={false}
              onStart={start}
            />
          ))}
        </div>
      ) : (
        <ProviderButton
          provider={rest[0]}
          label={`${actionLabel} with ${rest[0].name}`}
          showLabel
          onStart={start}
        />
      )}
    </>
  );
}
