"use client";

import { useState, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AuthLayout } from "@/components/auth/auth-layout";
import {
  AuthHeading,
  AuthOutcome,
  authFocusRing,
} from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/components/providers/auth-provider";
import { TeamJoinForm } from "@/components/teams/team-join-form";
// Shared with app/teams/join/loading.tsx so the route fallback and the page's
// own waiting state are the same element rather than two copies of it.
import { TeamJoinLoading } from "@/components/teams/team-join-loading";
import { TeamJoinSuccess } from "@/components/teams/team-join-success";
import { TeamJoinInvalid } from "@/components/teams/team-join-invalid";
import { APP_NAME } from "@/lib/config/client-constants";
import { cn } from "@/lib/ui/utils";

function JoinContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const { me, isLoading } = useAuth();
  const [success, setSuccess] = useState(false);

  if (!token) return <TeamJoinInvalid />;
  if (success) return <TeamJoinSuccess />;

  if (isLoading)
    return <TeamJoinLoading label="Checking who you are signed in as" />;

  // Accepting an invite needs a session. Sending an anonymous visitor into
  // the accept button just produced a 401 they could do nothing about.
  if (!me?.userId) {
    const back = `/teams/join?token=${encodeURIComponent(token)}`;
    return (
      <AuthOutcome
        tone="positive"
        title="Sign in to accept this invitation"
        actions={
          <>
            <Button
              asChild
              size="lg"
              className={cn("h-11 w-full", authFocusRing)}
            >
              <Link href={`/login?redirect=${encodeURIComponent(back)}`}>
                Sign in
              </Link>
            </Button>
            <Button
              asChild
              variant="outline"
              size="lg"
              className={cn("h-11 w-full border-border/60", authFocusRing)}
            >
              <Link href="/signup">Create an account first</Link>
            </Button>
          </>
        }
        footnote="Signing in brings you straight back to this invitation. If you sign up instead, open the invite link from your email again once the account is verified."
      >
        <p>
          Team membership attaches to an account, so we need to know which one
          to add. The invite stays valid in the meantime.
        </p>
      </AuthOutcome>
    );
  }

  return (
    <>
      <AuthHeading
        title="Team invitation"
        description={`You have been invited to join a team on ${APP_NAME}. Accept to get access.`}
      />
      <TeamJoinForm token={token} onSuccess={() => setSuccess(true)} />
    </>
  );
}

export default function JoinTeamPage() {
  return (
    <AuthLayout>
      <Suspense fallback={<TeamJoinLoading />}>
        <JoinContent />
      </Suspense>
    </AuthLayout>
  );
}
