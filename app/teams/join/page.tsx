"use client";

import { useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { ThemedLogo } from "@/components/shared/themed-logo";
import { Loader2 } from "lucide-react";
import { APP_NAME } from "@/lib/config/constants";
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
    <Card className="border-border/50 bg-card/95 backdrop-blur-sm shadow-lg">
      <CardContent className="py-16 flex flex-col items-center gap-3">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Loading invitation...</p>
      </CardContent>
    </Card>
  );
}

export default function JoinTeamPage() {
  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Logo header */}
        <div className="flex items-center justify-center gap-2.5 mb-8">
          <ThemedLogo
            width={36}
            height={36}
            className="h-9 w-9"
            alt={`${APP_NAME} logo`}
          />
          <span className="text-2xl font-bold font-mono tracking-tight">
            {APP_NAME}
          </span>
        </div>

        {/* Join content */}
        <Suspense fallback={<LoadingState />}>
          <JoinContent />
        </Suspense>

        {/* Footer */}
        <p className="text-center text-xs text-muted-foreground mt-8">
          Secure team collaboration powered by {APP_NAME}
        </p>
      </div>
    </div>
  );
}
