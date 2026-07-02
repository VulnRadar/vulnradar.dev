"use client";

import { useState } from "react";
import { SignupForm } from "@/components/auth/signup-form";
import { SignupSuccess } from "@/components/auth/signup-success";
import { AuthLayout } from "@/components/auth/auth-layout";

export default function SignupPage() {
  const [successEmail, setSuccessEmail] = useState<string | null>(null);

  return (
    <AuthLayout>
      <div style={{ animation: "fade-in 0.2s ease-out both" }}>
        {!successEmail ? (
          <>
            <div className="mb-7">
              <h1 className="text-2xl font-semibold tracking-tight">
                Create an account
              </h1>
              <p className="text-sm text-muted-foreground mt-1.5">
                Enter your details to get started.
              </p>
            </div>
            <SignupForm onSuccess={(email) => setSuccessEmail(email)} />
          </>
        ) : (
          <SignupSuccess email={successEmail} />
        )}
      </div>
    </AuthLayout>
  );
}
