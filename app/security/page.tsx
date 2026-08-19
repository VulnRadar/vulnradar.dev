import Link from "next/link";
import { APP_NAME, ROUTES, SEO_GITHUB_URL } from "@/lib/config/constants";
import { getSetting } from "@/lib/config/runtime-config";
import { PublicPageShell } from "@/components/shared/public-page-shell";
import {
  LegalSection,
  LegalList,
  LegalCallout,
  LegalToc,
} from "@/components/legal";

const SECTIONS = [
  { id: "report", label: "Reporting a vulnerability" },
  { id: "include", label: "What to put in the report" },
  { id: "expect", label: "What happens next" },
  { id: "in-scope", label: "In scope" },
  { id: "out-of-scope", label: "Out of scope" },
  { id: "safe-harbor", label: "Safe harbor" },
  { id: "disclosure", label: "Coordinated disclosure" },
];

// The response times we actually commit to, taken from SECURITY.md so the
// human page and the repo policy can't quietly disagree. Rendered as a plain
// two-column list, not a row of identical status cards.
const RESPONSE_PHASES: { label: string; time: string }[] = [
  { label: "We acknowledge your report", time: "Within 48 hours" },
  { label: "We send an initial assessment", time: "Within 5 business days" },
  { label: "We ship a fix", time: "Depends on severity" },
  {
    label: "We coordinate public disclosure",
    time: "With you, typically around 90 days",
  },
];

export default async function SecurityPage() {
  const securityEmail = await getSetting("SECURITY_EMAIL");
  const reportSubject = "%5BSECURITY%5D%20";

  return (
    <PublicPageShell maxWidth="max-w-4xl" padding="py-8 sm:py-10">
      <article className="space-y-10">
        {/* Header. Matches the legal pages' header rhythm but carries a
            security kicker rather than reusing LegalPageHeader's legal one. */}
        <header className="border-b border-border/50 pb-6">
          <p className="mb-2 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-primary/70">
            Security · Responsible disclosure
          </p>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">
            Report a security issue
          </h1>
          <p className="mt-3 max-w-prose text-sm leading-relaxed text-muted-foreground">
            {APP_NAME} is a security scanner, so we hold our own code to the
            same bar. If you have found a vulnerability, we want to hear about
            it before anyone else does. This page is the one place that tells
            you how to reach us, what we treat as in scope, and what you can
            expect once you hit send.
          </p>
        </header>

        {/* Primary action, given the most weight on the page: the address to
            email and the one thing not to do (file a public issue). */}
        <LegalCallout variant="info" title="Email us, do not open a public issue">
          <p>
            Send your report to{" "}
            <a
              href={`mailto:${securityEmail}?subject=${reportSubject}`}
              className="font-medium text-primary hover:underline"
            >
              {securityEmail}
            </a>
            . Start the subject line with{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
              [SECURITY]
            </code>{" "}
            so it routes straight to the people who can act on it.
          </p>
          <p className="mt-3">
            Please do not open a public GitHub issue, post it in a discussion,
            or drop it in Discord. A public report tips off attackers while the
            hole is still open. Email keeps it between us until there is a fix.
          </p>
          <p className="mt-3 text-xs text-foreground/70">
            We do not publish a PGP key yet. If a report has to be encrypted,
            say so in a first plaintext email (no secrets in that one) and we
            will set up a channel.
          </p>
        </LegalCallout>

        <LegalToc items={SECTIONS} />

        <LegalSection id="report" title="Reporting a vulnerability">
          <p>
            Email{" "}
            <a
              href={`mailto:${securityEmail}?subject=${reportSubject}`}
              className="text-primary hover:underline"
            >
              {securityEmail}
            </a>{" "}
            with enough detail for us to reproduce the problem. If you would
            rather not email, the{" "}
            <Link href={ROUTES.CONTACT} className="text-primary hover:underline">
              contact form
            </Link>{" "}
            reaches the same inbox, but email is faster and lets you attach a
            proof of concept.
          </p>
          <p>
            One report per issue is easier for both of us to track. If you found
            several unrelated problems, send them separately so each gets its
            own thread and its own fix.
          </p>
        </LegalSection>

        <LegalSection id="include" title="What to put in the report">
          <p>
            The more of this you include, the faster we can confirm and fix it:
          </p>
          <LegalList
            items={[
              "What the vulnerability is and what an attacker could actually do with it.",
              "Step-by-step instructions to reproduce it, or a short proof-of-concept.",
              "The affected URL, endpoint, or component, plus the version or commit SHA if you know it.",
              "Whether you are testing the hosted service or a self-hosted deployment.",
              "The name or handle you want credited, if you want credit at all.",
            ]}
          />
        </LegalSection>

        <LegalSection id="expect" title="What happens next">
          <p>
            You are not shouting into a void. Here is the timeline we hold
            ourselves to once a valid report lands:
          </p>
          <dl className="max-w-prose divide-y divide-border/50 overflow-hidden rounded-lg border border-border/50">
            {RESPONSE_PHASES.map((phase) => (
              <div
                key={phase.label}
                className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4"
              >
                <dt className="text-sm font-medium text-foreground">
                  {phase.label}
                </dt>
                <dd className="text-sm text-muted-foreground sm:text-right">
                  {phase.time}
                </dd>
              </div>
            ))}
          </dl>
          <p>
            If a report turns out to be a duplicate or out of scope, we will
            tell you that too, rather than leaving you guessing.
          </p>
        </LegalSection>

        {/* In / out of scope, side by side on wide screens so the contrast
            reads at a glance instead of as two more stacked lists. */}
        <div className="grid gap-8 md:grid-cols-2">
          <LegalSection id="in-scope" title="In scope">
            <p>Things we very much want reports about:</p>
            <LegalList
              items={[
                "Authentication, authorization, and session handling.",
                "Injection of any kind: XSS, SQL injection, SSRF, command injection.",
                "Information disclosure: other users' PII, API keys, or scan results.",
                "Rate-limit and quota bypasses.",
                "Billing and Stripe integration bugs.",
                "Scanner correctness: a check that misses a real vulnerability.",
                "Self-hosted deployment security: Docker, secrets, environment variables.",
              ]}
            />
          </LegalSection>

          <LegalSection id="out-of-scope" title="Out of scope">
            <p>Reports we will most likely close without a fix:</p>
            <LegalList
              items={[
                "Denial of service through large or expensive scan requests. We rate-limit those on purpose.",
                "Issues in third-party services we do not control, such as Stripe itself.",
                "Raw scanner output with no demonstrated impact.",
                "Theoretical findings with no concrete attack path.",
                "Self-hosted deployments that skip our hardening guide.",
                "Missing security headers on pages that carry no sensitive data.",
              ]}
            />
          </LegalSection>
        </div>

        <LegalSection id="safe-harbor" title="Safe harbor">
          <p>
            If you make a good-faith effort to follow this policy, we will treat
            your research as authorized. We will not pursue legal action against
            you or ask a third party to, and we will not report you to law
            enforcement for the testing itself.
          </p>
          <p>Good faith means, concretely:</p>
          <LegalList
            items={[
              "Test only against your own account and your own targets, never another user's data.",
              "Stop as soon as you have confirmed a vulnerability, do not go digging further into real data.",
              "Do not run attacks that degrade the service for others, such as sustained load or spam.",
              "Give us a reasonable window to fix the issue before you tell anyone else.",
            ]}
          />
          <p>
            This is not a paid bug bounty. We credit researchers who want it,
            but there is no cash reward.
          </p>
        </LegalSection>

        <LegalSection id="disclosure" title="Coordinated disclosure">
          <p>
            We disclose fixed issues publicly, and we would like you to be part
            of that. We aim to coordinate a disclosure date with you once a fix
            is out, usually around 90 days after the report, sooner for a small
            fix and longer for anything that needs a careful rollout.
          </p>
          <p>
            The machine-readable version of this policy lives at{" "}
            <a
              href="/.well-known/security.txt"
              className="text-primary hover:underline"
            >
              /.well-known/security.txt
            </a>
            , and the full written policy is in{" "}
            <a
              href={`${SEO_GITHUB_URL}/blob/main/SECURITY.md`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              SECURITY.md
            </a>{" "}
            in the repo, where you will also find how to verify a signed
            release.
          </p>
        </LegalSection>

        <div className="max-w-prose border-t border-border/50 pt-6">
          <p className="text-xs text-muted-foreground">
            {APP_NAME} is open source. Read the code, file non-security bugs, or
            open a pull request on{" "}
            <a
              href={SEO_GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              GitHub
            </a>
            . For anything that is not a security issue, use the{" "}
            <Link href={ROUTES.CONTACT} className="text-primary hover:underline">
              contact page
            </Link>
            .
          </p>
        </div>
      </article>
    </PublicPageShell>
  );
}
