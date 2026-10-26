import {
  HANDLER_HEADER,
  binaryReport,
  echo,
  json,
} from "../../../../../../lib/echo.js";

const ROUTE = "v4-history-report";

// One route, several response shapes, selected by ?format and ?fail. They
// stand for what the real report route returns: a JSON body, a binary PDF
// with its own headers, and the error responses the wrappers produce.
export async function GET(request, context) {
  const { searchParams } = request.nextUrl;
  const fail = searchParams.get("fail");

  if (fail === "429") {
    return json(
      { error: "Rate limit exceeded.", code: "RATE_LIMITED" },
      {
        status: 429,
        headers: {
          "retry-after": "7",
          "x-ratelimit-remaining": "0",
          [HANDLER_HEADER]: ROUTE,
        },
      },
    );
  }
  if (fail === "401") {
    return json(
      { error: "Unauthenticated.", code: "UNAUTHENTICATED" },
      {
        status: 401,
        headers: {
          "www-authenticate": 'Bearer realm="VulnRadar"',
          [HANDLER_HEADER]: ROUTE,
        },
      },
    );
  }
  if (fail === "500") {
    return json(
      { error: "Internal error.", code: "INTERNAL" },
      { status: 500, headers: { [HANDLER_HEADER]: ROUTE } },
    );
  }
  if (fail === "throw") {
    throw new Error("spike: handler threw");
  }

  if (searchParams.get("format") === "pdf") {
    return new Response(binaryReport(), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": 'attachment; filename="report.pdf"',
        "cache-control": "private, no-store",
        [HANDLER_HEADER]: ROUTE,
      },
    });
  }

  // The handler setting a header the middleware also sets: the harness
  // records which of the two reaches the client.
  if (searchParams.get("collide") === "1") {
    return echo(request, context, ROUTE, {
      headers: {
        "x-request-id": "handler-chosen",
        "content-security-policy": "default-src 'none'",
        deprecation: "handler",
        link: '<https://handler.invalid/>; rel="help"',
      },
    });
  }

  return echo(request, context, ROUTE);
}
