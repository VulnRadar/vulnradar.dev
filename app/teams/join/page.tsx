"use client";

import { useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { AuthLayout } from "@/components/auth/auth-layout";
import { TeamJoinForm } from "@/components/teams/team-join-form";
import { TeamJoinSuccess } from "@/components/teams/team-join-success";
import { TeamJoinInvalid } from "@/components/teams/team-join-invalid";

function JoinContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const [success, setSuccess] = useState(false);

  if (!token) {
    return <TeamJoinInvalid />;
  }

  if (success) {
    return <TeamJoinSuccess />;
  }

  return <TeamJoinForm token={token} onSuccess={() => setSuccess(true)} />;
}

function LoadingState() {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2.5">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground shrink-0" />
        <h1 className="text-2xl font-semibold tracking-tight">Loading</h1>
      </div>
      <p className="text-sm text-muted-foreground">
        Checking your invitation...
      </p>
    </div>
  );
}

export default function JoinTeamPage() {
  return (
    <AuthLayout>
      <div style={{ animation: "fade-in 0.2s ease-out both" }}>
        <Suspense fallback={<LoadingState />}>
          <JoinContent />
        </Suspense>
      </div>
    </AuthLayout>
  );
}
