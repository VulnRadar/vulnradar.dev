import React from "react";
import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { ThemeProvider } from "@/components/providers/theme-provider";
import { TosGate } from "@/components/auth/tos-gate";
import { BackupCodesModal } from "@/components/shared/notification-center";
import { DiscordProfileModalWrapper } from "@/components/modals/discord-profile-modal-wrapper";
import { AuthProvider } from "@/components/providers/auth-provider";
import { StaffHeartbeat } from "@/components/admin/staff-heartbeat";
import { SiteNotificationsWrapper } from "@/components/shared/site-notifications";
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
  BRANDING_BACKGROUND_DARK,
  BRANDING_BACKGROUND_LIGHT,
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
  // Was a hardcoded blue that did not match the cyan brand. Now driven by
  // the same config value the PWA manifest uses.
  themeColor: [
    {
      media: "(prefers-color-scheme: light)",
      color: BRANDING_BACKGROUND_LIGHT,
    },
    { media: "(prefers-color-scheme: dark)", color: BRANDING_BACKGROUND_DARK },
  ],
  colorScheme: "dark light",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang={SEO_LANGUAGE}
      className="dark"
      suppressHydrationWarning
      data-scroll-behavior="smooth"
    >
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var d=localStorage.getItem("vr_auth_cache");if(d&&d.length>2){var p=JSON.parse(d),s=document.createElement("style");s.id="vr-auth-css";var r="";if(p&&p.userId){r+=".vr-auth-only{visibility:visible!important;pointer-events:auto!important}"}if(p&&p.role&&${JSON.stringify([STAFF_ROLES.ADMIN, STAFF_ROLES.MODERATOR, STAFF_ROLES.SUPPORT])}.includes(p.role)){r+=".vr-staff-only{display:flex!important}"}if(r){s.textContent=r;document.head.appendChild(s)}}}catch(e){}`,
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
            <SiteNotificationsWrapper />
            <TosGate>{children}</TosGate>
            <BackupCodesModal />
            <DiscordProfileModalWrapper />
            <ChatWidget />
          </AuthProvider>
        </ThemeProvider>
        {/*        <Script id="tawk-to" strategy="lazyOnload">*/}
        {/*          {`var Tawk_API=Tawk_API||{}, Tawk_LoadStart=new Date();*/}
        {/*Tawk_API.onLoad = function(){*/}
        {/*  if(window.innerWidth < 640){*/}
        {/*    Tawk_API.setProperty('fontSize', 14);*/}
        {/*    var el = document.querySelector('iframe[title="chat widget"]');*/}
        {/*    if(el){*/}
        {/*      el.style.minWidth = '80px';*/}
        {/*      el.style.minHeight = '80px';*/}
        {/*    }*/}
        {/*  }*/}
        {/*};*/}
        {/*Tawk_API.customStyle = {*/}
        {/*  visibility: {*/}
        {/*    desktop: { position: 'br', xOffset: 20, yOffset: 20 },*/}
        {/*    mobile: { position: 'br', xOffset: 10, yOffset: 10 },*/}
        {/*  },*/}
        {/*  zIndex: 999*/}
        {/*};*/}
        {/*(function(){*/}
        {/*var s1=document.createElement("script"),s0=document.getElementsByTagName("script")[0];*/}
        {/*s1.async=true;*/}
        {/*s1.src='https://embed.tawk.to/6993aa8073d8cb1c357e314e/1jhkd41di';*/}
        {/*s1.charset='UTF-8';*/}
        {/*s1.setAttribute('crossorigin','*');*/}
        {/*s0.parentNode.insertBefore(s1,s0);*/}
        {/*})();`}*/}
        {/*        </Script>*/}
      </body>
    </html>
  );
}
