"use client";

import { useState } from "react";
import { SignupForm } from "@/components/auth/signup-form";
import { SignupSuccess } from "@/components/auth/signup-success";
import { AuthSplitLayout } from "@/components/auth/auth-split-layout";
import { AuthHeading, AuthSteps } from "@/components/auth/auth-shell";

export default function SignupPage() {
  const [successEmail, setSuccessEmail] = useState<string | null>(null);

  return (
    <AuthSplitLayout>
      <AuthSteps current={successEmail ? 2 : 1} total={2} />
      {!successEmail ? (
        <>
          <AuthHeading
            title="Create your account"
            description="Free, no card. You get a verification email, then the scanner, the API, and your history."
          />
          <SignupForm onSuccess={(email) => setSuccessEmail(email)} />
        </>
      ) : (
        <SignupSuccess email={successEmail} />
      )}
    </AuthSplitLayout>
  );
}
