import React from "react";
import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { Inter, JetBrains_Mono } from "next/font/google";
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
import { ChatWidget } from "@/components/ai-chat/chat-widget";

import "./globals.css";

const _inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const _jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
});

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
  // Pages without their own canonical fall back to the site root rather than
  // competing with each other under multiple URLs.
  alternates: { canonical: "/" },
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
  const nonce = (await headers()).get("x-nonce") ?? undefined;

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
            // The staff-role list here must match isStaffRole()
            // (lib/auth/permissions-client.ts), which auth-provider.tsx
            // uses post-hydration for the same .vr-staff-only class --
            // derived from STAFF_ROLES itself (every role except USER) so
            // a role added there doesn't also need remembering here, the
            // way the SSR fast-path drifted before (a 3-role hardcoded
            // list, missing 5 of the then-current 8 staff roles).
            __html: `try{var d=localStorage.getItem("vr_auth_cache");if(d&&d.length>2){var p=JSON.parse(d),s=document.createElement("style");s.id="vr-auth-css";var r="";if(p&&p.userId){r+=".vr-auth-only{visibility:visible!important;pointer-events:auto!important}"}if(p&&p.role&&${JSON.stringify(Object.values(STAFF_ROLES).filter((r) => r !== STAFF_ROLES.USER))}.includes(p.role)){r+=".vr-staff-only{display:flex!important}"}if(r){s.textContent=r;document.head.appendChild(s)}}}catch(e){}`,
          }}
        />
      </head>
      <body className="font-sans antialiased" suppressHydrationWarning>
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
            <BackupCodesModal />
            <DiscordProfileModalWrapper />
            <GithubProfileModalWrapper />
            <ChatWidget />
            <CookieNotice />
            <Toaster />
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
