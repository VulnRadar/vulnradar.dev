import Image from "next/image";

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
  alt = "VulnRadar logo",
}: ThemedLogoProps) {
  // Single SVG icon (public/favicon.svg) is used for both light and dark mode.
  // It has a dark slate background that contrasts against both light and dark
  // browser chrome, so a separate light/dark variant isn't needed.
  return (
    <span className={`inline-flex ${className}`} style={{ width, height }}>
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
