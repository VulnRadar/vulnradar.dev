"use client"

import { useTheme } from "next-themes"
import Image from "next/image"
import { useEffect, useState } from "react"

interface ThemedLogoProps {
  width?: number
  height?: number
  className?: string
  alt?: string
}

export function ThemedLogo({ width = 24, height = 24, className = "", alt = "VulnRadar logo" }: ThemedLogoProps) {
  const { resolvedTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  // Avoid hydration mismatch - show default until mounted
  if (!mounted) {
    return (
      <Image
        src="/favicon.svg"
        alt={alt}
        width={width}
        height={height}
        className={className}
      />
    )
  }

  const src = resolvedTheme === "dark" ? "/favicon-dark.svg" : "/favicon-light.svg"

  return (
    <Image
      src={src}
      alt={alt}
      width={width}
      height={height}
      className={className}
    />
  )
}
