import React from "react";
import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { ThemeProvider } from "@/components/providers/theme-provider";
import { TosGate } from "@/components/auth/tos-gate";
import { BackupCodesModal } from "@/components/shared/notification-center";
import { DiscordProfileModalWrapper } from "@/components/modals/discord-profile-modal-wrapper";
import { GithubProfileModalWrapper } from "@/components/modals/github-profile-modal-wrapper";
import { AuthProvider } from "@/components/providers/auth-provider";
import { Toaster } from "@/components/ui/toaster";
import { StaffHeartbeat } from "@/components/admin/staff-heartbeat";
import { ImpersonationBanner } from "@/components/admin/impersonation-banner";
import { SiteNotificationsWrapper } from "@/components/shared/site-notifications";
import { CookieNotice } from "@/components/shared/cookie-notice";
import { Ipv4Capture } from "@/components/shared/ipv4-capture";
import { OfflineBanner } from "@/components/shared/offline-banner";
import { CommandPalette } from "@/components/shared/command-palette";
import { MaintenanceScreen } from "@/components/shared/maintenance-screen";
import { maintenanceGate } from "@/lib/admin/service-state";
import {
  APP_NAME,
  APP_DESCRIPTION,
  APP_URL,
  STAFF_ROLES,
  SEO_TAGLINE,
  SEO_KEYWORDS,
  SEO_OG_IMAGE,
  SEO_OG_IMAGE_WIDTH,
  SEO_OG_IMAGE_HEIGHT,
  SEO_TWITTER_HANDLE,
  SEO_LOCALE,
  SEO_LANGUAGE,
  SEO_GOOGLE_VERIFICATION,
  SEO_BING_VERIFICATION,
  BRANDING_PRIMARY_COLOR,
} from "@/lib/config/constants";
import { SiteStructuredData } from "@/components/seo/structured-data";
import { ChatWidgetMount } from "@/components/shared/chat-widget-mount";
import { TourMount } from "@/components/shared/tour/tour-mount";

import "./globals.css";

// next/font used to load Inter and JetBrains Mono here into `--font-inter`
// and `--font-jetbrains-mono`, and nothing ever consumed either variable:
// <body> is `font-sans` and tailwind.config.mjs has no fontFamily extension,
// so every surface in this app has always rendered in Tailwind's default
// ui-sans-serif / ui-monospace system stack. The half-wired loaders still
// made the build emit 13 woff2 files, a 4 KB stylesheet with 15 @font-face
// rules linked from every page, and preload Link headers for two of the
// woff2s, all for glyphs no element asked for. Removed rather than wired up,
// because wiring them up would restyle every page in the product, which is a
// design decision and not a cleanup.

const SITE_TITLE = `${APP_NAME} - ${SEO_TAGLINE}`;

export const metadata: Metadata = {
  title: {
    default: SITE_TITLE,
    template: `%s | ${APP_NAME}`,
  },
  description: APP_DESCRIPTION,
  applicationName: APP_NAME,
  keywords: [...SEO_KEYWORDS],
  authors: [{ name: APP_NAME, url: APP_URL }],
  creator: APP_NAME,
  publisher: APP_NAME,
  // Pages without their own canonical fall back to the declared homepage
  // rather than competing with each other under multiple URLs. That is
  // "/landing", not "/": "/" always redirects (middleware.ts sends a signed-out
  // visitor to /landing and a signed-in one to /dashboard), so a canonical
  // pointing at it named a URL that never returns 200. Latent today because
  // every page sets its own canonical, but the next page added without a
  // pageMetadata() call would have inherited it.
  alternates: { canonical: "/landing" },
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml", sizes: "any" },
      { url: "/favicon.ico", sizes: "any" },
    ],
    apple: "/favicon.png",
  },
  manifest: "/manifest.webmanifest",
  openGraph: {
    title: SITE_TITLE,
    description: APP_DESCRIPTION,
    siteName: APP_NAME,
    type: "website",
    url: APP_URL,
    locale: SEO_LOCALE,
    images: [
      {
        url: SEO_OG_IMAGE,
        width: SEO_OG_IMAGE_WIDTH,
        height: SEO_OG_IMAGE_HEIGHT,
        alt: SITE_TITLE,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: APP_DESCRIPTION,
    // Previously `"@" + APP_NAME`, which published a handle that does not
    // necessarily exist. Omitted unless one is configured.
    ...(SEO_TWITTER_HANDLE ? { site: SEO_TWITTER_HANDLE } : {}),
    images: [SEO_OG_IMAGE],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  // Ownership tokens. Omitted entirely when unset, since an empty verification
  // tag reads as a failed check.
  ...(SEO_GOOGLE_VERIFICATION || SEO_BING_VERIFICATION
    ? {
        verification: {
          ...(SEO_GOOGLE_VERIFICATION
            ? { google: SEO_GOOGLE_VERIFICATION }
            : {}),
          ...(SEO_BING_VERIFICATION
            ? { other: { "msvalidate.01": SEO_BING_VERIFICATION } }
            : {}),
        },
      }
    : {}),
  other: {
    "security-contact": `${APP_URL}/.well-known/security.txt`,
  },
  metadataBase: new URL(APP_URL),
};

export const viewport: Viewport = {
  // Brand cyan, matching the same config value app/manifest.ts uses for the
  // PWA's theme_color. This is also what social embeds (Discord, etc.) read
  // for the link-preview accent bar, so it should be the brand color, not a
  // light/dark background shade.
  themeColor: BRANDING_PRIMARY_COLOR,
  colorScheme: "dark light",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Reading headers() here forces this layout (and everything under it) into
  // per-request dynamic rendering. That is required, not incidental: the
  // nonce below must match the CSP header middleware.ts generates fresh on
  // every single request, and a statically-prerendered page would otherwise
  // bake in a nonce from whenever it was first rendered/cached, which then
  // mismatches nearly every subsequent request's CSP header and gets every
  // script on the page blocked -- inline scripts and Next's own chunks alike.
  const requestHeaders = await headers();
  const nonce = requestHeaders.get("x-nonce") ?? undefined;

  // MAINTENANCE_MODE. Enforced here rather than in middleware.ts because the
  // switch is a database-backed registry setting and middleware compiles to
  // the Edge bundle, which cannot import node-postgres. This layout wraps
  // every page in the app, so one check here covers the whole UI surface;
  // middleware.ts keeps the environment-variable break-glass, which is the
  // form that still works when the database is the thing that is down.
  //
  // x-pathname is set by middleware.ts. maintenanceGate() lets /login through
  // for everyone and every path through for staff, so turning this on cannot
  // lock out the person who has to turn it off.
  const maintenance = await maintenanceGate(requestHeaders.get("x-pathname"));
  if (maintenance.active) {
    return (
      <html
        lang={SEO_LANGUAGE}
        className="dark"
        suppressHydrationWarning
        data-scroll-behavior="smooth"
      >
        <body className="font-sans antialiased" suppressHydrationWarning>
          {/* No AuthProvider, no TosGate, no widgets: every one of those
              fetches on mount, and this page has to render on a deployment
              whose database is unreachable. ThemeProvider is kept so the
              screen is not a flash of the wrong palette. */}
          <ThemeProvider
            attribute="class"
            defaultTheme="dark"
            enableSystem
            disableTransitionOnChange
          >
            <MaintenanceScreen message={maintenance.message} />
          </ThemeProvider>
        </body>
      </html>
    );
  }

  return (
    <html
      lang={SEO_LANGUAGE}
      className="dark"
      suppressHydrationWarning
      data-scroll-behavior="smooth"
    >
      <head>
        <script
          nonce={nonce}
          dangerouslySetInnerHTML={{
            // Stamps two data attributes on <html> from the cached session so
            // the signed-in chrome is correct on the first paint instead of
            // flashing in after /auth/me resolves. The matching rules are in
            // app/globals.css.
            //
            // It sets attributes and nothing else. The previous version built
            // a <style> element and appended it to document.head, which runs
            // before React hydrates: React then found a node in <head> that
            // its tree did not contain, reported the markup as mismatched and
            // regenerated the whole tree on the client. That regeneration
            // re-entered every route's Suspense boundary, which is why every
            // page rendered its loading.tsx skeleton a second time on top of
            // its own. <html> already carries suppressHydrationWarning, which
            // is exactly what makes an attribute safe to set here.
            //
            // The staff-role list must match isStaffRole()
            // (lib/auth/permissions-client.ts), which auth-provider.tsx uses
            // post-hydration for the same .vr-staff-only class. Derived from
            // STAFF_ROLES itself (every role except USER) so a role added
            // there does not also need remembering here, the way the SSR
            // fast-path drifted before (a 3-role hardcoded list, missing 5 of
            // the then-current 8 staff roles).
            __html: `try{var d=localStorage.getItem("vr_auth_cache");if(d&&d.length>2){var p=JSON.parse(d),e=document.documentElement;if(p&&p.userId){e.setAttribute("data-vr-auth","1");if(p.role&&${JSON.stringify(Object.values(STAFF_ROLES).filter((r) => r !== STAFF_ROLES.USER))}.includes(p.role)){e.setAttribute("data-vr-staff","1")}}}}catch(e){}`,
          }}
        />
      </head>
      <body className="font-sans antialiased" suppressHydrationWarning>
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[100] focus:rounded-md focus:bg-background focus:px-4 focus:py-2 focus:text-foreground focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-primary"
        >
          Skip to main content
        </a>
        <SiteStructuredData />
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange
        >
          <AuthProvider>
            <StaffHeartbeat />
            <Ipv4Capture />
            <ImpersonationBanner />
            <SiteNotificationsWrapper />
            <TosGate>{children}</TosGate>
            {/* App-wide, not per page: the product tour walks the reader from
                the scanner through History, Compare, Profile and Teams, and a
                mount inside any one of those would unmount and restart it at
                every crossing. TourMount keeps the tour's own code off the
                ~790 public routes that will never run it. */}
            <TourMount />
            <BackupCodesModal />
            <DiscordProfileModalWrapper />
            <GithubProfileModalWrapper />
            <ChatWidgetMount />
            <CookieNotice />
            <OfflineBanner />
            <CommandPalette />
            <Toaster />
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
