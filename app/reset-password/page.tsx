"use client";

import { useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import {
  ResetPasswordForm,
  ResetPasswordSuccess,
  ResetPasswordInvalid,
} from "@/components/auth";
import { AuthLayout } from "@/components/auth/auth-layout";

function ResetContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const [success, setSuccess] = useState(false);
  const isInvalid = !token;

  return (
    <div style={{ animation: "fade-in 0.2s ease-out both" }}>
      {isInvalid ? (
        <ResetPasswordInvalid />
      ) : success ? (
        <ResetPasswordSuccess />
      ) : (
        <>
          <div className="mb-7">
            <h1 className="text-2xl font-semibold tracking-tight">
              Set new password
            </h1>
            <p className="text-sm text-muted-foreground mt-1.5">
              Choose a strong, unique password for your account.
            </p>
          </div>
          <ResetPasswordForm
            token={token!}
            onSuccess={() => setSuccess(true)}
          />
        </>
      )}
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <AuthLayout>
      <Suspense fallback={null}>
        <ResetContent />
      </Suspense>
    </AuthLayout>
  );
}
