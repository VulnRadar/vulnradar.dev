import type { ReactNode } from "react";

export type DocsAudience = "use" | "build" | "run" | "shared";
export type DocsTemplate = "quickstart" | "guide" | "reference" | "concept";

export interface TocItem {
  id: string;
  label: string;
  level?: number;
}

export interface NavItem {
  href: string;
  label: string;
  /** One line describing what the page answers. Drawer and search. */
  summary: string;
  /** Which required sections the page owes: tests/repo/docs-templates.test.ts. */
  template: DocsTemplate;
  /** The page's file, for "Edit this page", last-updated and the repo tests. */
  source: string;
  /**
   * Static table of contents, one module per page under components/docs/toc,
   * so the shell needs no effect to know it and a page that changes its
   * sections edits that module rather than this table.
   */
  toc: TocItem[];
  exact?: boolean;
  /** Pages nested under this one, listed once in DOCS_PAGES after it. */
  children?: NavItem[];
}

/**
 * The sidebar is grouped rather than a flat list so a reader can tell where
 * they are in the whole set: guides first, then reference material.
 */
export interface NavSection {
  id: string;
  title: string;
  audience: DocsAudience;
  /** Numbered and read in order; the pager says "Step n of N". */
  path?: boolean;
  items: NavItem[];
}

export interface EndpointParam {
  name: string;
  type: string;
  description: string;
  required?: boolean;
  /** Value used when the caller omits the parameter. */
  default?: string;
}

export interface EndpointError {
  code: number;
  description: string;
}

export interface EndpointNote {
  /** A warning renders as a Callout; everything else is a plain list item. */
  tone: "info" | "warning";
  body: ReactNode;
}

export interface Endpoint {
  id: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  title: string;
  description: string;
  requestBody?: string;
  responseExample: string;
  /** Defaults to 200. */
  successStatus?: number;
  /** The request body's fields, listed above the example. */
  bodyParams?: EndpointParam[];
  queryParams?: EndpointParam[];
  pathParams?: EndpointParam[];
  errors?: EndpointError[];
  /** Plain strings are the old form, accepted for one release. */
  notes?: (string | EndpointNote)[];
  /** "API key with `scan:write`, or a session", or "Session only". */
  auth?: ReactNode;
  /** Playground operation id; adds a "Try it" link to it. */
  tryIt?: string;
}

/** Reason phrases for the success codes an endpoint card can show. */
export const STATUS_TEXT: Record<number, string> = {
  200: "OK",
  201: "Created",
  202: "Accepted",
  204: "No Content",
};

export interface QuickStat {
  value: string;
  label: string;
}

export interface Step {
  step: number;
  title: string;
  description: ReactNode;
}

// Method colors for endpoint badges
export const METHOD_COLORS = {
  GET: "bg-[hsl(var(--severity-low))]/20 text-[hsl(var(--severity-low))] border-[hsl(var(--severity-low))]/30",
  POST: "bg-[hsl(var(--success))]/20 text-[hsl(var(--success))] border-[hsl(var(--success))]/30",
  PUT: "bg-[hsl(var(--warning))]/20 text-[hsl(var(--warning))] border-[hsl(var(--warning))]/30",
  PATCH: "bg-primary/20 text-primary border-primary/30",
  DELETE:
    "bg-[hsl(var(--severity-critical))]/20 text-[hsl(var(--severity-critical))] border-[hsl(var(--severity-critical))]/30",
} as const;

// Severity colors, on the same --severity-* scale the scan report uses.
export const SEVERITY_COLORS = {
  critical: "text-[hsl(var(--severity-critical))]",
  high: "text-[hsl(var(--severity-high))]",
  medium: "text-[hsl(var(--severity-medium))]",
  low: "text-[hsl(var(--severity-low))]",
  info: "text-[hsl(var(--severity-info))]",
} as const;
