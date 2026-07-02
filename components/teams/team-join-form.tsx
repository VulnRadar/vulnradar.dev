"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Loader2, AlertTriangle } from "lucide-react";
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
    <div className="space-y-7">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Team invitation
        </h1>
        <p className="text-sm text-muted-foreground mt-1.5">
          You have been invited to join a team on {APP_NAME}. Accept to get
          access.
        </p>
      </div>

      {error && (
        <div className="flex items-center gap-2.5 text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-4 py-3">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="flex gap-3">
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
            "Accept invite"
          )}
        </Button>
        <Link href="/teams" className="flex-1">
          <Button variant="outline" className="w-full h-11">
            Decline
          </Button>
        </Link>
      </div>
    </div>
  );
}
