import Link from "next/link";
import { FaGithub } from "react-icons/fa";
import { APP_REPO, ROUTES } from "@/lib/config/constants";
import { CONFIG_DISCORD_INVITE_URL } from "@/lib/config/config-values";

export function LandingOpenSource() {
  return (
    <section className="py-16 sm:py-20">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="grid lg:grid-cols-[1fr_380px] gap-10 lg:gap-20 items-start">
          <div>
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight mb-4">
              It is all in the open
            </h2>
            <div className="space-y-3 text-muted-foreground leading-relaxed">
              <p>
                Every scanner check, every API route, and every dashboard
                component is in the public repo under GPL-3.0. There is no
                closed-source detection engine bolted on the side. What you see
                in the SaaS is exactly what you can run yourself.
              </p>
              <p>
                Self-hosting takes one Dockerfile and a Postgres connection
                string. The setup guide walks through the rest.
              </p>
            </div>

            <div className="mt-8 flex flex-wrap gap-3">
              <a
                href={`https://github.com/${APP_REPO}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-border/60 bg-card text-sm font-medium text-foreground hover:bg-muted transition-colors"
              >
                <FaGithub className="h-4 w-4" />
                {APP_REPO}
              </a>
              <Link
                href={`${ROUTES.DOCS}/self-hosting`}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-border/60 bg-card text-sm font-medium text-foreground hover:bg-muted transition-colors"
              >
                Self-host guide
              </Link>
              <a
                href={CONFIG_DISCORD_INVITE_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-border/60 bg-card text-sm font-medium text-foreground hover:bg-muted transition-colors"
              >
                Discord community
              </a>
            </div>
          </div>

          {/* Right: compact facts */}
          <div className="space-y-0 divide-y divide-border/40 text-sm border border-border/50 rounded-xl overflow-hidden">
            {[
              { label: "License", value: "GPL-3.0" },
              { label: "Stack", value: "Next.js · PostgreSQL · TypeScript" },
              { label: "Telemetry", value: "None" },
              { label: "Third-party trackers", value: "None" },
              { label: "Scanner engine", value: "Open source" },
              { label: "Issues", value: "Tracked on GitHub" },
            ].map(({ label, value }) => (
              <div
                key={label}
                className="flex justify-between items-baseline px-4 py-3"
              >
                <span className="text-muted-foreground">{label}</span>
                <span className="font-medium text-foreground text-right">
                  {value}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
