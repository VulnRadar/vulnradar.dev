"use client";

import { InlineAlert } from "@/components/shared/inline-alert";
import { plural, pluralize } from "@/lib/ui/plural";

/**
 * Search on this page filters what was loaded, so a capped list has to say it
 * is capped or a host past the cap simply reads as never scanned.
 */
export function AssetsTruncatedNotice({
  scope,
  shown,
  totalHosts,
}: {
  scope: "mine" | "all";
  shown: number;
  totalHosts: number;
}) {
  return (
    <InlineAlert tone="info" live="off">
      {scope === "all"
        ? `Showing the ${shown} most recently scanned public ${plural(shown, "host")}. Older ones are not listed, and search only covers this list.`
        : `Showing the ${shown} most recently scanned of your ${pluralize(totalHosts, "host")}. Search only covers this list, and the rest are still in History.`}
    </InlineAlert>
  );
}
