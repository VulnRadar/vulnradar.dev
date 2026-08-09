"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { SignupForm } from "@/components/auth/signup-form";
import { SignupSuccess } from "@/components/auth/signup-success";
import { AuthSplitLayout } from "@/components/auth/auth-split-layout";
import { AuthHeading, AuthSteps } from "@/components/auth/auth-shell";

export default function SignupPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-background" />}>
      <SignupPageContent />
    </Suspense>
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
