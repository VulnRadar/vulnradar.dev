import { headers } from "next/headers"
import { AUTH_HEADER, BEARER_PREFIX } from "./constants"

/**
 * Client information helpers
 */

/**
 * Extract client IP from request headers
 * Handles proxies and load balancers gracefully
 */
export async function getClientIp(): Promise<string> {
  const h = await headers()
  return (
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    h.get("x-real-ip") ||
    h.get("cf-connecting-ip") ||
    "unknown"
  )
}

/**
 * Get user agent from request
 */
export async function getUserAgent(): Promise<string> {
  const h = await headers()
  return h.get("user-agent") || "unknown"
}

/**
 * Get referer from request
 */
export async function getReferer(): Promise<string | null> {
  const h = await headers()
  return h.get("referer")
}

/**
 * Extract bearer token from authorization header
 */
export async function getBearerToken(): Promise<string | null> {
  const h = await headers()
  const authHeader = h.get(AUTH_HEADER)
  if (!authHeader?.startsWith(BEARER_PREFIX)) return null
  return authHeader.slice(BEARER_PREFIX.length)
}

/**
 * Check if request is from a bot/crawler
 */
export async function isBot(): Promise<boolean> {
  const ua = await getUserAgent()
  const botPatterns = [/bot/i, /crawler/i, /spider/i, /scraper/i, /headless/i, /googlebot/i, /bingbot/i]
  return botPatterns.some((pattern) => pattern.test(ua))
}

/**
 * Check if request is CORS preflight
 */
export function isPreflight(method: string): boolean {
  return method === "OPTIONS"
}

/**
 * Get request method safe-check
 */
export function isMethod(method: string, ...allowed: string[]): boolean {
  return allowed.includes(method.toUpperCase())
}
