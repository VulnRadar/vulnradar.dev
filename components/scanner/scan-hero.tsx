"use client";

export function ScanHero() {
  return (
    <section aria-label="Scan your website" className="pt-7 sm:pt-9 pb-3">
      <h1 className="text-lg font-semibold text-foreground tracking-tight">
        Scan a URL
      </h1>
      <p className="text-sm text-muted-foreground mt-1">
        Checks headers, SSL, cookies, content, and configuration in seconds.
      </p>
    </section>
  );
}
