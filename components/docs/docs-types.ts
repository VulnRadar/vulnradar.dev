export interface TocItem {
  id: string;
  label: string;
  level?: number;
}

export interface NavItem {
  href: string;
  label: string;
  /** One line describing what the page answers. Shown in the mobile nav. */
  summary?: string;
  exact?: boolean;
}

/**
 * The sidebar is grouped rather than a flat list so a reader can tell where
 * they are in the whole set: guides first, then reference material.
 */
export interface NavSection {
  title: string;
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

export interface Endpoint {
  id: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  title: string;
  description: string;
  requestBody?: string;
  responseExample: string;
  queryParams?: EndpointParam[];
  pathParams?: EndpointParam[];
  errors?: EndpointError[];
  notes?: string[];
  auth?: boolean;
}

export interface QuickStat {
  value: string;
  label: string;
}

export interface Step {
  step: number;
  title: string;
  description: string;
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
