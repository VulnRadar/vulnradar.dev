"use client";

import { parseUrl } from "./compare-types";
import { cn } from "@/lib/ui/utils";

interface UrlDisplayProps {
  url: string;
  className?: string;
  size?: "sm" | "md";
}

export function UrlDisplay({ url, className, size = "sm" }: UrlDisplayProps) {
  const { subdomain, host, path } = parseUrl(url);

  const textSize = size === "md" ? "text-sm" : "text-xs";
  const fontClass = "font-mono";

  return (
    <span
      className={cn("flex items-baseline gap-0 min-w-0 max-w-full", className)}
      title={url}
    >
      {subdomain && (
        <>
          <span
            className={cn(
              textSize,
              fontClass,
              "text-muted-foreground shrink-0 min-w-0 max-w-[80px] truncate",
            )}
          >
            {subdomain}
          </span>
          <span
            className={cn(
              textSize,
              fontClass,
              "text-muted-foreground shrink-0",
            )}
          >
            .
          </span>
        </>
      )}
      <span
        className={cn(
          textSize,
          fontClass,
          "font-medium shrink-0 min-w-0 max-w-[180px] truncate",
        )}
      >
        {host}
      </span>
      {path && (
        <span
          className={cn(
            textSize,
            fontClass,
            "text-muted-foreground/70 min-w-0 max-w-[140px] truncate",
          )}
        >
          {path}
        </span>
      )}
    </span>
  );
}
