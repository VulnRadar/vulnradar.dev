"use client";

export function ScanHero() {
  return (
    <section aria-label="Scanner" className="pt-8 sm:pt-12 pb-5 text-center">
      <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
        Scan Your Website for Vulnerabilities
      </h1>
      <p className="text-sm text-muted-foreground mt-2 max-w-sm mx-auto leading-relaxed">
        Enter any URL to run security checks across headers, SSL, cookies, content, and configuration.
      </p>
    </section>
  );
}
