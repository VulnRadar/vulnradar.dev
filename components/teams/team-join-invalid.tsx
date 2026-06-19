"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { AlertTriangle, ArrowRight } from "lucide-react";
import Link from "next/link";

export function TeamJoinInvalid() {
  return (
    <Card className="border-border/50 bg-card/95 backdrop-blur-sm shadow-lg">
      <CardContent className="py-12 flex flex-col items-center gap-4">
        {/* Warning icon */}
        <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/20">
          <AlertTriangle className="h-8 w-8 text-amber-500" />
        </div>

        {/* Error message */}
        <div className="text-center space-y-2">
          <h1 className="text-xl font-semibold tracking-tight">
            Invalid Invite Link
          </h1>
          <p className="text-sm text-muted-foreground leading-relaxed">
            This invitation link is missing a valid token or has expired.
          </p>
        </div>

        {/* Action button */}
        <Link href="/teams">
          <Button variant="outline" className="gap-2 border-border/40 mt-2">
            Go to Teams
            <ArrowRight className="h-4 w-4" />
          </Button>
        </Link>
      </CardContent>
    </Card>
  );
}
