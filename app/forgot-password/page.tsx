"use client";

import { useState } from "react";
import { ForgotPasswordForm, ForgotPasswordSuccess } from "@/components/auth";
import { AuthSplitLayout } from "@/components/auth/auth-split-layout";
import { AuthHeading, AuthSteps } from "@/components/auth/auth-shell";

export default function ForgotPasswordPage() {
  const [sentTo, setSentTo] = useState<string | null>(null);

  return (
    <AuthSplitLayout>
      <AuthSteps current={sentTo ? 2 : 1} total={2} />
      {sentTo ? (
        <ForgotPasswordSuccess email={sentTo} />
      ) : (
        <>
          <AuthHeading
            title="Reset your password"
            description="Tell us the email on the account and we will send a link that lets you set a new password."
          />
          <ForgotPasswordForm onSuccess={(email) => setSentTo(email)} />
        </>
      )}
    </AuthSplitLayout>
  );
}
