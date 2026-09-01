import Image from "next/image";
import { APP_NAME } from "@/lib/config/client-constants";
// Straight from config-values rather than constants' LOGO_URL, which is the
// absolute form (APP_URL + this) that emails and structured data need. An
// <Image src> wants the path, and an absolute URL here would also have to be
// allowlisted in next.config's image domains.
import { CONFIG_LOGO_URL } from "@/lib/config/config-values";

interface ThemedLogoProps {
  width?: number;
  height?: number;
  className?: string;
  alt?: string;
}

export function ThemedLogo({
  width = 24,
  height = 24,
  className = "",
  alt = `${APP_NAME} logo`,
}: ThemedLogoProps) {
  // A single icon serves both light and dark mode: the shipped default
  // (public/favicon.svg) has a dark slate background that contrasts against
  // both light and dark browser chrome, so a separate variant isn't needed.
  // The path is read from CONFIG_LOGO_URL rather than hardcoded, so a
  // self-hoster who points that at their own mark gets it in the app header
  // too, not only in emails and structured data.
  //
  // No inline width/height style here: every call site already passes a
  // matching Tailwind size class (h-6 w-6, h-7 w-7, ...), which sizes this
  // span identically -- the inline style was pure duplication.
  return (
    <span className={`inline-flex ${className}`}>
      <Image
        src={CONFIG_LOGO_URL}
        alt={alt}
        width={width}
        height={height}
        priority
      />
    </span>
  );
}
