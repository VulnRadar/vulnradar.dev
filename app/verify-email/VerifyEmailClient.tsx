"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  VerifyEmailLoading,
  VerifyEmailSuccess,
  VerifyEmailError,
  VerifyEmailExpired,
  VerifyEmailAlready,
} from "@/components/auth";
import { AuthLayout } from "@/components/auth/auth-layout";
import { API, ROUTES } from "@/lib/config/client-constants";

type VerifyStatus =
  "loading" | "success" | "error" | "expired" | "already-verified";

export default function VerifyEmailClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const verificationAttempted = useRef(false);

  const [status, setStatus] = useState<VerifyStatus>("loading");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!token) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- derives initial UI state from a URL param read once on mount, guarded by verificationAttempted below from ever re-firing
      setStatus("error");
      setMessage(
        "The link you followed has no token on it, so there is nothing to check. Some mail clients cut long links in half.",
      );
      return;
    }

    // Prevent double-execution in React strict mode
    if (verificationAttempted.current) return;
    verificationAttempted.current = true;

    async function verify() {
      try {
        const res = await fetch(API.AUTH.VERIFY_EMAIL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });

        const data = await res.json();

        if (data.alreadyVerified) {
          setStatus("already-verified");
          setMessage(data.message);
          return;
        }

        if (data.expired) {
          setStatus("expired");
          setMessage(data.error);
          return;
        }

        if (!res.ok) {
          setStatus("error");
          setMessage(
            data.error ||
              "The token on this link is not one we recognise. It may already have been used.",
          );
          return;
        }

        setStatus("success");
        setMessage(data.message);

        // Redirect to dashboard after 2 seconds
        setTimeout(() => {
          router.push(ROUTES.DASHBOARD);
          router.refresh();
        }, 2000);
      } catch {
        setStatus("error");
        setMessage(
          "We could not reach the server to check this link. Try again in a moment.",
        );
      }
    }

    verify();
  }, [token, router]);

  function renderContent() {
    switch (status) {
      case "loading":
        return <VerifyEmailLoading />;
      case "success":
        return <VerifyEmailSuccess message={message} />;
      case "error":
        return <VerifyEmailError message={message} />;
      case "expired":
        return <VerifyEmailExpired message={message} />;
      case "already-verified":
        return <VerifyEmailAlready message={message} />;
      default:
        return <VerifyEmailLoading />;
    }
  }

  return <AuthLayout>{renderContent()}</AuthLayout>;
}
