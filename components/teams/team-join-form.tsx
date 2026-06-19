"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Users, Loader2, AlertTriangle } from "lucide-react";
import Link from "next/link";
import { APP_NAME, API } from "@/lib/config/constants";

interface TeamJoinFormProps {
  token: string;
  onSuccess: () => void;
}

export function TeamJoinForm({ token, onSuccess }: TeamJoinFormProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleAccept() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(API.TEAMS_ACCEPT_INVITE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to accept invite");
        return;
      }
      onSuccess();
      setTimeout(() => router.push("/teams"), 2000);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="border-border/50 bg-card/95 backdrop-blur-sm shadow-lg">
      <CardContent className="py-10 px-8 flex flex-col items-center gap-6">
        {/* Icon */}
        <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 border border-primary/20">
          <Users className="h-8 w-8 text-primary" />
        </div>

        {/* Title */}
        <div className="text-center space-y-2">
          <h1 className="text-xl font-semibold tracking-tight">
            Team Invitation
          </h1>
          <p className="text-sm text-muted-foreground leading-relaxed">
            You have been invited to join a team on {APP_NAME}.
          </p>
        </div>

        {/* Error message */}
        {error && (
          <div className="flex items-center gap-2.5 text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-4 py-3 w-full">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex gap-3 w-full">
          <Button
            onClick={handleAccept}
            disabled={loading}
            className="flex-1 h-11 font-medium"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Joining...
              </>
            ) : (
              "Accept Invite"
            )}
          </Button>
          <Link href="/teams" className="flex-1">
            <Button variant="outline" className="w-full h-11 border-border/40">
              Decline
            </Button>
          </Link>
        </div>

        {/* Footer link */}
        <p className="text-xs text-muted-foreground">
          Changed your mind?{" "}
          <Link href="/teams" className="text-primary hover:underline">
            Go to Teams
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
