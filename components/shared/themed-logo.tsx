import Image from "next/image";
import { APP_NAME } from "@/lib/config/constants";

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
  // Single SVG icon (public/favicon.svg) is used for both light and dark mode.
  // It has a dark slate background that contrasts against both light and dark
  // browser chrome, so a separate light/dark variant isn't needed.
  //
  // No inline width/height style here: every call site already passes a
  // matching Tailwind size class (h-6 w-6, h-7 w-7, ...), which sizes this
  // span identically -- the inline style was pure duplication.
  return (
    <span className={`inline-flex ${className}`}>
      <Image
        src="/favicon.svg"
        alt={alt}
        width={width}
        height={height}
        priority
      />
    </span>
  );
}
