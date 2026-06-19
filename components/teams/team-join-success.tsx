"use client";

import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle2, Loader2 } from "lucide-react";

export function TeamJoinSuccess() {
  return (
    <Card className="border-border/50 bg-card/95 backdrop-blur-sm shadow-lg">
      <CardContent className="py-12 flex flex-col items-center gap-4">
        {/* Success icon */}
        <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-emerald-500/10 border border-emerald-500/20">
          <CheckCircle2 className="h-8 w-8 text-emerald-500" />
        </div>

        {/* Success message */}
        <div className="text-center space-y-2">
          <h1 className="text-xl font-semibold tracking-tight text-emerald-500">
            Welcome to the Team!
          </h1>
          <p className="text-sm text-muted-foreground">
            You have successfully joined the team.
          </p>
        </div>

        {/* Redirect indicator */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground mt-2">
          <Loader2 className="h-3 w-3 animate-spin" />
          <span>Redirecting to teams...</span>
        </div>
      </CardContent>
    </Card>
  );
}
