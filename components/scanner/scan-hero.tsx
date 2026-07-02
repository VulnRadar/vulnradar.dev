"use client";

export function ScanHero() {
  return (
    <section aria-label="Scanner" className="pt-6 sm:pt-8 pb-4">
      <h1 className="text-2xl font-bold tracking-tight text-foreground">Scanner</h1>
      <p className="text-sm text-muted-foreground mt-1">
        Enter a URL below to run a security scan. Headers, SSL, cookies, content, and configuration.
      </p>
    </section>
  );
}
