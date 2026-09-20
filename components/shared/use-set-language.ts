"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { API } from "@/lib/config/client-constants";
import type { Locale } from "@/lib/i18n/config";

/**
 * Save the reader's language and re-render in it.
 *
 * router.refresh() rather than a reload: the language is resolved server-side
 * per request (lib/i18n/request.ts), so re-rendering the route is enough, and
 * whatever the reader had open stays open. Shared by the switcher in the
 * header and the one on the profile so both behave the same.
 */
export function useSetLanguage() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function setLanguage(next: Locale) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(API.ACCOUNT_LANGUAGE, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale: next }),
      });
      // The answer is judged by what came back, not by res.ok. A request that
      // middleware sends to the login page is a 200 full of HTML once fetch
      // has followed the redirect, which is exactly how this failed the first
      // time: the site stayed in English and nothing was reported.
      const body = (await res.json().catch(() => null)) as {
        locale?: string;
        error?: string;
      } | null;
      if (!res.ok || body?.locale !== next) {
        throw new Error(body?.error || "The language could not be saved.");
      }
      startTransition(() => router.refresh());
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "The language could not be saved.",
      );
    } finally {
      setSaving(false);
    }
  }

  return { setLanguage, busy: saving || pending, error };
}
