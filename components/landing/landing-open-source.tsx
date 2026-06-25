import Link from "next/link";
import { MessagesSquare, Server, BookOpen, ArrowRight } from "lucide-react";
import { FaGithub } from "react-icons/fa";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { APP_REPO, ROUTES } from "@/lib/config/constants";
import { CONFIG_DISCORD_INVITE_URL } from "@/lib/config/config-values";

export function LandingOpenSource() {
  return (
    <section className="py-16 sm:py-24 border-t border-border/50">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="max-w-2xl mb-10">
          <p className="text-xs font-medium text-primary uppercase tracking-wider mb-2">
            Open source
          </p>
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight mb-3 text-balance">
            Built in public. Licensed GPL-3.0. Self-hostable.
          </h2>
          <p className="text-muted-foreground text-pretty">
            Every check, every API route, every dashboard pixel is in the public
            repo. Audit it, fork it, run it on your own infra. We don&apos;t
            have a closed-source scanner engine bolted on the side. the SaaS is
            the same code you can deploy.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-4 min-w-0">
          <Card className="p-5 sm:p-6">
            <FaGithub className="h-5 w-5 text-foreground mb-4 shrink-0" />
            <h3 className="text-base font-semibold mb-1.5">Source on GitHub</h3>
            <p className="text-sm text-muted-foreground mb-4 break-words">
              Read the code, file issues, send PRs. Releases are tagged and
              changelogged per version.
            </p>
            <Button
              asChild
              variant="outline"
              size="sm"
              className="h-8 w-full sm:w-auto"
            >
              <a
                href={`https://github.com/${APP_REPO}`}
                target="_blank"
                rel="noreferrer"
              >
                <span className="truncate">{APP_REPO}</span>
                <ArrowRight className="h-3.5 w-3.5 ml-1 shrink-0" />
              </a>
            </Button>
          </Card>

          <Card className="p-5 sm:p-6">
            <Server className="h-5 w-5 text-foreground mb-4 shrink-0" />
            <h3 className="text-base font-semibold mb-1.5">Self-host</h3>
            <p className="text-sm text-muted-foreground mb-4 break-words">
              Next.js process + Postgres. One Dockerfile, one .env. Self-host
              guide walks through the rest.
            </p>
            <Button
              asChild
              variant="outline"
              size="sm"
              className="h-8 w-full sm:w-auto"
            >
              <Link href={`${ROUTES.DOCS}/self-hosting`}>
                Read the guide
                <ArrowRight className="h-3.5 w-3.5 ml-1 shrink-0" />
              </Link>
            </Button>
          </Card>

          <Card className="p-5 sm:p-6">
            <MessagesSquare className="h-5 w-5 text-foreground mb-4 shrink-0" />
            <h3 className="text-base font-semibold mb-1.5">Community</h3>
            <p className="text-sm text-muted-foreground mb-4 break-words">
              Discord for questions, bug reports, and request-a-check threads.
              Maintainers reply in-thread.
            </p>
            <Button
              asChild
              variant="outline"
              size="sm"
              className="h-8 w-full sm:w-auto"
            >
              <a
                href={CONFIG_DISCORD_INVITE_URL}
                target="_blank"
                rel="noreferrer"
              >
                Join Discord
                <ArrowRight className="h-3.5 w-3.5 ml-1" />
              </a>
            </Button>
          </Card>
        </div>

        <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <BookOpen className="h-3.5 w-3.5" />
            License: GPL-3.0
          </span>
          <span aria-hidden className="text-muted-foreground/50 select-none">
            ·
          </span>
          <span>Stack: Next.js · PostgreSQL · TypeScript</span>
          <span aria-hidden className="text-muted-foreground/50 select-none">
            ·
          </span>
          <span>No telemetry. No third-party trackers.</span>
        </div>
      </div>
    </section>
  );
}
