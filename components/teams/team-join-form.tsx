"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { API } from "@/lib/config/constants";
import { cn } from "@/lib/ui/utils";
import { AuthAlert, authFocusRing } from "@/components/auth/auth-shell";

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
    <div className="flex flex-col gap-4">
      {error && <AuthAlert>{error}</AuthAlert>}

      <div className="flex flex-col gap-2.5">
        <Button
          onClick={handleAccept}
          disabled={loading}
          size="lg"
          className={cn("h-11 w-full gap-2", authFocusRing)}
        >
          {loading && (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          )}
          {loading ? "Joining..." : "Accept invite"}
        </Button>
        <Button
          asChild
          variant="outline"
          size="lg"
          className={cn("h-11 w-full border-border/60", authFocusRing)}
        >
          <Link href="/teams">Decline</Link>
        </Button>
      </div>
    </div>
  );
}
