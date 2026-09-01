"use client";

// Moved to components/shared/callout.tsx once /legal and /security needed the
// same aside. Re-exported under the old name so the 19 docs pages that render
// it did not all have to change.
export {
  Callout as DocsCallout,
  type CalloutProps as DocsCalloutProps,
  type CalloutVariant,
} from "@/components/shared/callout";
