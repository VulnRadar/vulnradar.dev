import { NextResponse } from "next/server";
import { isIP } from "node:net";
import { getClientIp } from "@/lib/api/request-utils";
import { signIpv4Token } from "@/lib/auth/ipv4-echo-token";
import { APP_URL } from "@/lib/config/constants";

/**
 * "What IP am I on right now?" echo. Unauthenticated: it only ever tells a
 * caller their own IP, which they already have.
 *
 * Its whole purpose is to be served on an IPv4-only hostname (a DNS A record
 * with no AAAA). A dual-stack browser fetching that hostname is forced onto
 * IPv4, so getClientIp() here observes the caller's IPv4 even when they reached
 * the main app over IPv6. When the observed address is IPv4 we also hand back a
 * short-lived signed token (see lib/auth/ipv4-echo-token.ts); the browser
 * relays it to POST /api/v3/auth/sessions/ipv4, which records it on the current
 * session. The signature is why a client cannot report an IPv4 it wasn't seen
 * from. When the caller is on IPv6 (no IPv4 route) there is no token and
 * nothing is recorded.
 *
 * Cross-origin: this is reached from the main app origin on a different
 * subdomain, so it sets an explicit Access-Control-Allow-Origin. No cookies
 * are involved (the request is credential-less), so no allow-credentials.
 */
export async function GET() {
  const ip = await getClientIp();
  const body: { ip: string; token?: string } =
    isIP(ip) === 4 ? { ip, token: signIpv4Token(ip, Date.now()) } : { ip };

  const res = NextResponse.json(body);
  res.headers.set("Access-Control-Allow-Origin", new URL(APP_URL).origin);
  res.headers.set("Vary", "Origin");
  res.headers.set("Cache-Control", "no-store");
  return res;
}
