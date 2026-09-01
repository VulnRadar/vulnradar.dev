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
import { Skeleton } from "@/components/ui/skeleton";

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
      {/* fallback={null} was prerendered into the static HTML, and the pitch
          column beside it is hidden below lg, so first paint on a phone was
          wordmark, empty band, footer. Give the band something with the shape
          of the form that replaces it. */}
      <Suspense fallback={<ResetFormSkeleton />}>
        <ResetContent />
      </Suspense>
    </AuthSplitLayout>
  );
}

function ResetFormSkeleton() {
  return (
    <>
      <AuthSteps current={1} total={2} />
      <div className="mb-6">
        <Skeleton className="h-8 w-52" />
        <Skeleton className="mt-3 h-4 w-full max-w-xs" />
      </div>
      <div className="space-y-4">
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-11 w-full" />
      </div>
    </>
  );
}
