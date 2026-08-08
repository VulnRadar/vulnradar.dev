interface LandingHowItWorksProps {
  categoryCount: number;
}

export function LandingHowItWorks({ categoryCount }: LandingHowItWorksProps) {
  return (
    <section className="py-16 sm:py-20">
      <div className="max-w-3xl mx-auto px-4 sm:px-6">
        <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight mb-6 text-balance">
          What actually happens when you hit scan
        </h2>

        <div className="space-y-5 text-muted-foreground leading-relaxed text-[15px] sm:text-base">
          <p>
            The request leaves our servers, not your browser. No session
            cookies, no VPN, no corporate proxy in the path. What comes back is
            what an unauthenticated stranger on the internet sees, which is
            usually the thing you actually wanted to know.
          </p>
          <p>
            From there the response fans out to {categoryCount} independent
            modules at once. One reads the headers. One finishes the TLS
            handshake and looks at the certificate chain. One resolves DNS and
            checks SPF, DMARC and CAA. One walks the HTML and the linked
            JavaScript looking for keys people did not mean to ship. None of
            them wait for each other.
          </p>
        </div>

        <blockquote className="my-8 border-l-2 border-primary pl-5 sm:pl-6">
          <p className="text-lg sm:text-xl font-medium tracking-tight text-foreground text-balance">
            No model decides your severity. The same URL produces the same
            finding IDs and the same ratings on every run, which is the only
            reason a diff between two scans means anything.
          </p>
        </blockquote>

        <div className="space-y-5 text-muted-foreground leading-relaxed text-[15px] sm:text-base">
          <p>
            Every finding carries the raw evidence it was derived from, so you
            can check our work rather than take it on faith. If you disagree
            with a call, the check ID tells you exactly which rule fired, and
            the rule is in the public repo.
          </p>
          <p>
            Most scans are done in under three seconds. Targets with slow DNS or
            a long certificate chain take longer, and the report tells you how
            long yours took.
          </p>
        </div>
      </div>
    </section>
  );
}
