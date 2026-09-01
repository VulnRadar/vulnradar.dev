"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { SignupForm } from "@/components/auth/signup-form";
import { SignupSuccess } from "@/components/auth/signup-success";
import { AuthSplitLayout } from "@/components/auth/auth-split-layout";
import { AuthHeading, AuthSteps } from "@/components/auth/auth-shell";
import { Skeleton } from "@/components/ui/skeleton";

export default function SignupPage() {
  return (
    <Suspense fallback={<SignupFormSkeleton />}>
      <SignupPageContent />
    </Suspense>
  );
}

/**
 * Prerendered into the static HTML, so this is literally the first paint on a
 * phone and the whole of what a crawler sees for /signup. It used to be an
 * empty full-height div. Mirrors app/login/page.tsx's fallback.
 */
function SignupFormSkeleton() {
  return (
    <AuthSplitLayout>
      <AuthSteps current={1} total={2} />
      <div className="mb-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="mt-3 h-4 w-full max-w-xs" />
      </div>
      <div className="space-y-4">
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-4 w-32" />
      </div>
    </AuthSplitLayout>
  );
}

function SignupPageContent() {
  const searchParams = useSearchParams();
  const authError = searchParams.get("error");
  const authErrorMessage = searchParams.get("message");
  const [successEmail, setSuccessEmail] = useState<string | null>(null);

  const getInitialError = () => {
    // Google/GitHub/Discord sign-up-or-sign-in
    // (app/api/v3/auth/oauth/[provider]/callback/route.ts) refuses to
    // silently sign someone into an account that already exists just
    // because they clicked "Sign up with X" -- this mirrors the login
    // page's oauth_no_account message for the opposite case.
    if (authError === "oauth_already_exists")
      return (
        (authErrorMessage && decodeURIComponent(authErrorMessage)) ||
        "You already have an account connected to that sign-in. Sign in instead."
      );
    return "";
  };

  return (
    <AuthSplitLayout>
      <AuthSteps current={successEmail ? 2 : 1} total={2} />
      {!successEmail ? (
        <>
          <AuthHeading
            title="Create your account"
            description="Free, no card. You get a verification email, then the scanner, the API, and your history."
          />
          <SignupForm
            onSuccess={(email) => setSuccessEmail(email)}
            initialError={getInitialError()}
          />
        </>
      ) : (
        <SignupSuccess email={successEmail} />
      )}
    </AuthSplitLayout>
  );
}
