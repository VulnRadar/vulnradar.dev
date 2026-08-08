"use client";

import { useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import {
  ResetPasswordForm,
  ResetPasswordSuccess,
  ResetPasswordInvalid,
} from "@/components/auth";
import { AuthSplitLayout } from "@/components/auth/auth-split-layout";
import { AuthHeading, AuthSteps } from "@/components/auth/auth-shell";

function ResetContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const [success, setSuccess] = useState(false);

  if (!token) return <ResetPasswordInvalid />;

  return (
    <>
      <AuthSteps current={success ? 2 : 1} total={2} />
      {success ? (
        <ResetPasswordSuccess />
      ) : (
        <>
          <AuthHeading
            title="Set a new password"
            description="Pick something you do not use anywhere else. A passphrase of a few unrelated words beats a short password with symbols in it."
          />
          <ResetPasswordForm token={token} onSuccess={() => setSuccess(true)} />
        </>
      )}
    </>
  );
}

export default function ResetPasswordPage() {
  return (
    <AuthSplitLayout>
      <Suspense fallback={null}>
        <ResetContent />
      </Suspense>
    </AuthSplitLayout>
  );
}
