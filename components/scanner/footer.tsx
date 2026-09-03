"use client";

import Link from "next/link";
import { Heart, Mail } from "lucide-react";
import { FaGithub } from "react-icons/fa";
import {
  APP_VERSION,
  APP_NAME,
  APP_URL,
  APP_REPO,
  SUPPORT_EMAIL,
  ROUTES,
  BILLING_ENABLED,
} from "@/lib/config/client-constants";
import { Button } from "@/components/ui/button";
import { ThemedLogo } from "@/components/shared/themed-logo";
import { SocialLinks } from "@/components/shared/social-links";
import { focus } from "@/lib/ui/animations";

// One shape for every icon link in the bottom bar, the pre-existing repo and
// email marks included, so the row stays uniform however many social accounts
// are configured. 44px below sm is the project's touch minimum; the mark
// itself stays h-4, so nothing about the row's visual weight changes. Pill
// radius per the radius ladder: this is an icon button.
const iconLinkClass = `inline-flex h-11 w-11 sm:h-9 sm:w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground ${focus.ring}`;

export function Footer() {
  return (
    <footer className="border-t border-border bg-background mt-auto">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <nav
          aria-label="Footer navigation"
          className="grid grid-cols-1 md:grid-cols-5 gap-10 mb-12"
        >
          {/* Brand */}
          <div className="md:col-span-2">
            <div className="flex items-center gap-2.5 mb-4">
              <ThemedLogo
                width={24}
                height={24}
                className="h-6 w-6"
                alt={`${APP_NAME} logo`}
              />
              <span className="text-base font-mono font-semibold text-foreground">
                {APP_NAME}
              </span>
              <span
                className="inline-flex items-center rounded-full bg-primary/10 border border-primary/30 px-2 py-0.5 text-[10px] font-medium font-mono text-primary"
                suppressHydrationWarning
              >
                v{APP_VERSION}
              </span>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed mb-5 max-w-xs">
              Open-source web security scanner. GPL-3.0, self-hostable, no
              telemetry.
            </p>
            <Link href={ROUTES.DONATE}>
              <Button
                variant="outline"
                size="sm"
                className="gap-2 h-9 border-primary/20 bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary hover:border-primary/30"
              >
                <Heart className="h-3.5 w-3.5 fill-current" />
                Support {APP_NAME}
              </Button>
            </Link>
          </div>

          {/* Product */}
          <div>
            <h3 className="font-semibold text-sm mb-4 text-foreground">
              Product
            </h3>
            <ul className="space-y-2.5 text-sm text-muted-foreground">
              <li>
                <Link
                  href={ROUTES.DASHBOARD}
                  className="hover:text-foreground transition-colors"
                >
                  Scanner
                </Link>
              </li>
              <li>
                <Link
                  href={ROUTES.HISTORY}
                  className="hover:text-foreground transition-colors"
                >
                  History
                </Link>
              </li>
              <li>
                <Link
                  href={ROUTES.COMPARE}
                  className="hover:text-foreground transition-colors"
                >
                  Compare
                </Link>
              </li>
              <li>
                <Link
                  href={ROUTES.BADGE}
                  className="hover:text-foreground transition-colors"
                >
                  Badges
                </Link>
              </li>
              {/* Scanner, History, Compare and Badges all need a session, so a
                  logged-out visitor's Product column was a list of redirects to
                  /login. These two need no account. */}
              <li>
                <Link
                  href="/tools"
                  className="hover:text-foreground transition-colors"
                >
                  Free tools
                </Link>
              </li>
              <li>
                <Link
                  href="/checks"
                  className="hover:text-foreground transition-colors"
                >
                  Check reference
                </Link>
              </li>
              {BILLING_ENABLED && (
                <li>
                  <Link
                    href={ROUTES.PRICING}
                    className="hover:text-foreground transition-colors"
                  >
                    Pricing
                  </Link>
                </li>
              )}
            </ul>
          </div>

          {/* Resources */}
          <div>
            <h3 className="font-semibold text-sm mb-4 text-foreground">
              Resources
            </h3>
            <ul className="space-y-2.5 text-sm text-muted-foreground">
              <li>
                <Link
                  href={ROUTES.CONTACT}
                  className="hover:text-foreground transition-colors"
                >
                  Contact
                </Link>
              </li>
              <li>
                <Link
                  href={ROUTES.DOCS}
                  className="hover:text-foreground transition-colors"
                >
                  Documentation
                </Link>
              </li>
              <li>
                <Link
                  href={ROUTES.DOCS_API}
                  className="hover:text-foreground transition-colors"
                >
                  API Reference
                </Link>
              </li>
              <li>
                <Link
                  href={ROUTES.DOCS_SETUP}
                  className="hover:text-foreground transition-colors"
                >
                  Setup Guide
                </Link>
              </li>
              <li>
                <Link
                  href={ROUTES.CHANGELOG}
                  className="hover:text-foreground transition-colors"
                >
                  Changelog
                </Link>
              </li>
              <li>
                <Link
                  href={ROUTES.PUBLIC_SCANS}
                  className="hover:text-foreground transition-colors"
                >
                  Public scans
                </Link>
              </li>
              <li>
                <Link
                  href="/alternatives"
                  className="hover:text-foreground transition-colors"
                >
                  Compared to other scanners
                </Link>
              </li>
              <li>
                <Link
                  href="/security"
                  className="hover:text-foreground transition-colors"
                >
                  Security
                </Link>
              </li>
            </ul>
          </div>

          {/* Legal */}
          <div>
            <h3 className="font-semibold text-sm mb-4 text-foreground">
              Legal
            </h3>
            <ul className="space-y-2.5 text-sm text-muted-foreground">
              <li>
                <Link
                  href={ROUTES.LEGAL_TERMS}
                  className="hover:text-foreground transition-colors"
                >
                  Terms of Service
                </Link>
              </li>
              <li>
                <Link
                  href={ROUTES.LEGAL_PRIVACY}
                  className="hover:text-foreground transition-colors"
                >
                  Privacy Policy
                </Link>
              </li>
              <li>
                <Link
                  href={ROUTES.LEGAL_ACCEPTABLE_USE}
                  className="hover:text-foreground transition-colors"
                >
                  Acceptable Use
                </Link>
              </li>
              <li>
                <Link
                  href={ROUTES.LEGAL_DISCLAIMER}
                  className="hover:text-foreground transition-colors"
                >
                  Disclaimer
                </Link>
              </li>
              <li>
                <Link
                  href="/legal/dmca"
                  className="hover:text-foreground transition-colors"
                >
                  DMCA Policy
                </Link>
              </li>
              <li>
                <Link
                  href="/legal/accessibility"
                  className="hover:text-foreground transition-colors"
                >
                  Accessibility
                </Link>
              </li>
              <li>
                <Link
                  href={ROUTES.GDPR_REQUEST}
                  className="hover:text-foreground transition-colors"
                >
                  GDPR / Data Request
                </Link>
              </li>
            </ul>
          </div>
        </nav>

        {/* Bottom bar */}
        <div className="border-t border-border pt-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-sm text-muted-foreground">
            {"\u00A9"} {new Date().getFullYear()} {APP_NAME}. For authorized
            security testing only.
          </p>
          {/* This row was already the footer's icon-link row (the repo mark
              and the support address), so the social accounts join it rather
              than getting a block of their own: same muted h-4 marks, same
              weight, one place to look. The -mx-2.5 cancels the padding the
              targets add so the row still lines up with the columns above.
              Wraps because the registry can hold ten platforms. */}
          <div className="flex flex-wrap items-center justify-center gap-y-1 -mx-2.5 sm:justify-end">
            <a
              href={`https://github.com/${APP_REPO}`}
              target="_blank"
              rel="noopener noreferrer"
              className={iconLinkClass}
              aria-label="GitHub"
              title="GitHub"
            >
              <FaGithub className="h-4 w-4" aria-hidden="true" />
            </a>
            <SocialLinks className={iconLinkClass} iconClassName="h-4 w-4" />
            <a
              href={`mailto:${SUPPORT_EMAIL}`}
              className={iconLinkClass}
              aria-label="Email"
              title="Email"
            >
              <Mail className="h-4 w-4" aria-hidden="true" />
            </a>
            <span className="px-2.5 text-xs text-muted-foreground">
              {APP_URL.replace(/^https?:\/\//, "")}
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
}
