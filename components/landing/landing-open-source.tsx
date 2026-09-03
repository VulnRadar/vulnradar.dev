import Link from "next/link";
import { FaGithub } from "react-icons/fa";
import { APP_REPO, ROUTES, SOCIAL_LINKS } from "@/lib/config/constants";
import { SocialLinks } from "@/components/shared/social-links";
import { focus } from "@/lib/ui/animations";

/** `href` is optional: a fact that can be checked gets a link to the thing
 *  that proves it, rather than asking the reader to take our word for it. */
const FACTS: { label: string; value: string; href?: string }[] = [
  { label: "License", value: "GPL-3.0" },
  { label: "Stack", value: "Next.js, PostgreSQL, TypeScript" },
  { label: "Detection engine", value: "In the repo, not a binary" },
  // "Telemetry: None" and "Third-party trackers: None" used to sit here as two
  // more bare facts in this grid. They now open the "What we never keep" block
  // below, alongside the credential fact, which is the one a prospect
  // evaluating authenticated scanning actually needs and which appeared
  // nowhere on the site at all (AUDIT-014#comp-10). Two words in a grid cell
  // could not carry it; a sentence can.
  {
    label: "Issue tracker",
    value: "Public, on GitHub",
    href: `https://github.com/${APP_REPO}/issues`,
  },
  {
    label: "Self-audits",
    value: "14, committed in the repo",
    href: `https://github.com/${APP_REPO}/tree/main/audits`,
  },
  {
    label: "Our own hardening checklist",
    value: "SECURITY-POSTURE.md",
    href: `https://github.com/${APP_REPO}/blob/main/SECURITY-POSTURE.md`,
  },
];

const linkClass =
  "inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-border/60 bg-card text-sm font-medium text-foreground hover:bg-muted transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring";

// The repo link is the point of this section, so it carries the accent the
// secondary links beside it deliberately don't.
const primaryLinkClass =
  "inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-primary/25 bg-primary/10 text-sm font-medium text-primary hover:bg-primary/15 transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring";

// Icon-only, and lighter than the two chips beside them on purpose: the repo
// is what this section is arguing for, the accounts are an aside. 44px below
// sm for the touch minimum, 36px from sm up so the group sits level with the
// chips. Pill radius per the radius ladder: these are icon buttons.
const socialLinkClass = `inline-flex h-11 w-11 sm:h-9 sm:w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground ${focus.ring}`;

export function LandingOpenSource() {
  return (
    <section className="py-16 sm:py-20 border-t border-border/50">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="max-w-2xl">
          <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight mb-4">
            It is all in the open
          </h2>
          <div className="space-y-4 text-muted-foreground leading-relaxed">
            <p>
              Every check, every API route, and every screen in the dashboard is
              in the public repo under GPL-3.0. There is no closed detection
              engine bolted on behind the login. What runs in the SaaS is what
              you can run yourself.
            </p>
            {/* The self-host sentence used to stand on its own word. It now
                names the thing that proves it, because this is the one claim
                on the page that a reader can only test by spending an hour on
                it, and it is the claim AUDIT-014#comp-01 found had quietly
                stopped being true. The CI job named here is the `selfhost`
                job in .github/workflows/ci.yml. */}
            <p>
              Self-hosting is one Dockerfile and a Postgres connection string,
              and CI checks that on every build: it builds the production image,
              boots it against an empty database, and fails if the schema does
              not come up. If you disagree with a severity rating, open the
              check, argue with it, and send a pull request.
            </p>
          </div>

          {/* The accounts ride in this row rather than getting a section of
              their own. This is already the "where else to find us" row (the
              repo, the self-host guide, and the Discord server that now shows
              as a mark instead of a chip, so no destination is linked twice),
              and a strip of identical icon cards under a "Follow us" heading
              is exactly the template the rest of this page avoids. Renders
              nothing when a deployment has configured no accounts. */}
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <a
              href={`https://github.com/${APP_REPO}`}
              target="_blank"
              rel="noreferrer"
              className={primaryLinkClass}
            >
              <FaGithub className="h-4 w-4" aria-hidden="true" />
              {APP_REPO}
            </a>
            <Link href={`${ROUTES.DOCS}/self-hosting`} className={linkClass}>
              Self-host guide
            </Link>
            {SOCIAL_LINKS.length > 0 && (
              <div className="flex flex-wrap items-center gap-1 sm:ml-1">
                <span className="mr-1 text-sm text-muted-foreground">
                  Also on
                </span>
                <SocialLinks
                  className={socialLinkClass}
                  iconClassName="h-4 w-4"
                />
              </div>
            )}
          </div>
        </div>

        <dl className="mt-12 grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-6 border-t border-border/50 pt-8">
          {FACTS.map(({ label, value, href }) => (
            <div key={label}>
              <dt className="text-xs uppercase tracking-wider text-muted-foreground mb-1.5">
                {label}
              </dt>
              <dd className="text-sm font-medium text-foreground leading-snug">
                {href ? (
                  <a
                    href={href}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-sm hover:text-primary hover:underline transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {value}
                  </a>
                ) : (
                  value
                )}
              </dd>
            </div>
          ))}
        </dl>

        {/* Deliberately not a card grid: a heading pinned left with prose
            running beside it, so this reads as a claim being made rather than
            three more feature tiles. */}
        <div className="mt-12 border-t border-border/50 pt-8 grid gap-4 sm:grid-cols-[minmax(0,13rem)_minmax(0,1fr)] sm:gap-10">
          <h3 className="text-lg font-semibold tracking-tight">
            What we never keep
          </h3>
          <div className="space-y-4 text-sm text-muted-foreground leading-relaxed max-w-2xl">
            <p>
              <span className="font-medium text-foreground">
                The login you scan with.
              </span>{" "}
              Authenticated scanning takes a username, token, or cookie in the
              scan request itself. It is held in memory for that one scan and is
              never written to a database, a log line, or the saved result. What
              gets recorded is that the scan was authenticated and by which
              method, never the material. There is no credential vault here to
              breach, which is also the honest trade-off: an authenticated scan
              is something you run, not something you leave on a schedule.
            </p>
            <p>
              <span className="font-medium text-foreground">
                Analytics about you.
              </span>{" "}
              No product telemetry and no third-party trackers, in the hosted
              app or in a copy you run yourself.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
