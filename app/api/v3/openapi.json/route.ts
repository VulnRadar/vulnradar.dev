import { NextResponse } from "next/server";
import { buildOpenApiSpec } from "@/lib/api/openapi-spec";
import { APP_URL } from "@/lib/config/constants";

// Rendered once at build. APP_URL, the only input, is inlined by the compiler
// (it reads NEXT_PUBLIC_APP_URL), so a per-request render could not differ.
export const dynamic = "force-static";

/**
 * The OpenAPI 3.1 description of the public v3 API. Unauthenticated: it
 * documents the API, it doesn't expose data. Cached for an hour. Import it into
 * an API client, or point an interactive explorer at it.
 */
export function GET() {
  return NextResponse.json(buildOpenApiSpec(APP_URL), {
    headers: { "Cache-Control": "public, max-age=3600, must-revalidate" },
  });
}
