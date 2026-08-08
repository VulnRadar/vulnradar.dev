import React from "react";
import { AuthLayout } from "@/components/auth/auth-layout";
import { VerifyEmailLoading } from "@/components/auth";
import VerifyEmailClient from "./VerifyEmailClient";

export default function VerifyEmailPage() {
  return (
    <React.Suspense
      fallback={
        <AuthLayout>
          <VerifyEmailLoading />
        </AuthLayout>
      }
    >
      <VerifyEmailClient />
    </React.Suspense>
  );
}
