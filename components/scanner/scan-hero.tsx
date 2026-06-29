"use client";

export function ScanHero() {
  return (
    <section
      aria-label="Scan your website"
      className="flex flex-col items-center text-center gap-1.5 pt-6 sm:pt-8 pb-3"
    >
      <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground max-w-3xl leading-tight">
        Scan Your Website for Vulnerabilities
      </h1>
      <p className="text-xs text-muted-foreground max-w-xl leading-relaxed">
        Enter any URL to run security checks across headers, SSL, cookies,
        content, and configuration.
      </p>
    </section>
  );
}
