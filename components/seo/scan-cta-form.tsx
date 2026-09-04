"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { demoScanHref } from "@/lib/seo/demo-link";

/**
 * The field the ~780 SEO pages were missing.
 *
 * Every check page, alternatives page and tools page closes by telling the
 * reader to scan their site, and /tools/api-scanner says "paste an API URL"
 * three separate times. None of them had anywhere to paste: the call to
 * action was two links, so a reader who arrived on a long-tail query and was
 * ready to act had to land on /demo and start over. The destination has
 * always accepted a target (app/demo/page.tsx reads ?url=), so this is the
 * missing half of a route that already worked.
 *
 * A client island rather than a change to ScanCta itself, because ScanCta is
 * rendered by server components and must stay statically renderable.
 *
 * No validation beyond "is there anything here": /demo owns the scheme
 * allowlist, the blocklist, the rebinding guard and the rate limit, and a
 * second opinion here would only be a worse one.
 */
export function ScanCtaForm() {
  const router = useRouter();
  const inputId = useId();
  const [value, setValue] = useState("");
  const href = demoScanHref(value);

  return (
    <form
      className="flex flex-col gap-2 sm:flex-row sm:items-center"
      onSubmit={(e) => {
        e.preventDefault();
        if (href) router.push(href);
      }}
    >
      <label htmlFor={inputId} className="sr-only">
        Site or URL to scan
      </label>
      <Input
        id={inputId}
        name="url"
        type="text"
        inputMode="url"
        autoComplete="url"
        spellCheck={false}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="yoursite.com"
        className="h-11 sm:max-w-xs"
      />
      <Button
        type="submit"
        size="lg"
        className="h-11 px-6 gap-2"
        disabled={!href}
      >
        Scan it
        <ArrowRight className="h-4 w-4" />
      </Button>
    </form>
  );
}
