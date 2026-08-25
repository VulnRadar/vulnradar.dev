import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { extractTargetsFromSpec } from "@/lib/scanner/spec-import";

/**
 * Turn an uploaded API spec into a list of scan targets. The caller sends the
 * parsed spec document; we detect the format (OpenAPI 3 / Swagger 2 / Postman)
 * and return the concrete URLs it declares. The caller then feeds those to the
 * bulk scan endpoint. We do NOT fetch a remote spec URL here on purpose: taking
 * the document directly keeps this off the SSRF surface.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const spec = (body as { spec?: unknown })?.spec;
  if (!spec || typeof spec !== "object") {
    return NextResponse.json(
      {
        error:
          "Provide a `spec`: a parsed OpenAPI 3, Swagger 2, or Postman collection document.",
      },
      { status: 400 },
    );
  }

  const { format, targets } = extractTargetsFromSpec(spec);
  if (format === "unknown") {
    return NextResponse.json(
      {
        error:
          "Unrecognized spec. Expected OpenAPI 3, Swagger 2, or a Postman collection.",
      },
      { status: 400 },
    );
  }
  if (targets.length === 0) {
    return NextResponse.json(
      {
        error:
          "No scannable URLs found. The spec has no absolute server/base URL (only templated or relative paths).",
        format,
      },
      { status: 400 },
    );
  }

  return NextResponse.json({ format, targets, count: targets.length });
}
