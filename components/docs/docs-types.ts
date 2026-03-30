import { LucideIcon } from "lucide-react"

export interface TocItem {
  id: string
  label: string
  level?: number
}

export interface NavItem {
  href: string
  label: string
  icon: LucideIcon
  exact?: boolean
}

export interface EndpointParam {
  name: string
  type: string
  description: string
  required?: boolean
}

export interface EndpointError {
  code: number
  description: string
}

export interface Endpoint {
  id: string
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"
  path: string
  title: string
  description: string
  requestBody?: string
  responseExample: string
  queryParams?: EndpointParam[]
  pathParams?: EndpointParam[]
  errors?: EndpointError[]
  notes?: string[]
  auth?: boolean
}

export interface QuickStat {
  value: string
  label: string
}

export interface Feature {
  icon: LucideIcon
  title: string
  description: string
}

export interface Step {
  step: number
  title: string
  description: string
}

// Method colors for endpoint badges
export const METHOD_COLORS = {
  GET: "bg-blue-600/20 text-blue-600 border-blue-600/30",
  POST: "bg-green-600/20 text-green-600 border-green-600/30",
  PUT: "bg-amber-600/20 text-amber-600 border-amber-600/30",
  PATCH: "bg-purple-600/20 text-purple-600 border-purple-600/30",
  DELETE: "bg-red-600/20 text-red-600 border-red-600/30",
} as const

// Severity colors
export const SEVERITY_COLORS = {
  critical: "text-red-600",
  high: "text-orange-500",
  medium: "text-yellow-500",
  low: "text-blue-500",
  info: "text-gray-500",
} as const
