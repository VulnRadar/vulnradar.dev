import Image from "next/image"

interface ThemedLogoProps {
  width?: number
  height?: number
  className?: string
  alt?: string
}

export function ThemedLogo({ width = 24, height = 24, className = "", alt = "VulnRadar logo" }: ThemedLogoProps) {
  // Use CSS-based theme detection to avoid hydration flash
  // Both images render, CSS hides the wrong one instantly based on .dark class
  return (
    <span className={`inline-flex ${className}`} style={{ width, height }}>
      {/* Light mode logo - hidden when .dark is present */}
      <Image
        src="/favicon-light.svg"
        alt={alt}
        width={width}
        height={height}
        className="dark:hidden block"
        priority
      />
      {/* Dark mode logo - shown only when .dark is present */}
      <Image
        src="/favicon-dark.svg"
        alt={alt}
        width={width}
        height={height}
        className="hidden dark:block"
        priority
      />
    </span>
  )
}
