import Link from "next/link";
import { FaGithub } from "react-icons/fa";
import { APP_REPO, ROUTES } from "@/lib/config/constants";
import { CONFIG_DISCORD_INVITE_URL } from "@/lib/config/config-values";

const FACTS: [string, string][] = [
  ["License", "GPL-3.0"],
  ["Stack", "Next.js, PostgreSQL, TypeScript"],
  ["Detection engine", "In the repo, not a binary"],
  ["Telemetry", "None"],
  ["Third-party trackers", "None"],
  ["Issue tracker", "Public, on GitHub"],
];

const linkClass =
  "inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-border/60 bg-card text-sm font-medium text-foreground hover:bg-muted transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring";

// The repo link is the point of this section, so it carries the accent the
// other two (secondary) links deliberately don't.
const primaryLinkClass =
  "inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-primary/25 bg-primary/10 text-sm font-medium text-primary hover:bg-primary/15 transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring";

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
            <p>
              Self-hosting is one Dockerfile and a Postgres connection string.
              If you disagree with a severity rating, open the check, argue with
              it, and send a pull request.
            </p>
          </div>

          <div className="mt-8 flex flex-wrap gap-3">
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
            <a
              href={CONFIG_DISCORD_INVITE_URL}
              target="_blank"
              rel="noreferrer"
              className={linkClass}
            >
              Discord
            </a>
          </div>
        </div>

        <dl className="mt-12 grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-6 border-t border-border/50 pt-8">
          {FACTS.map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs uppercase tracking-wider text-muted-foreground mb-1.5">
                {label}
              </dt>
              <dd className="text-sm font-medium text-foreground leading-snug">
                {value}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
