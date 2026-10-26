import { echo } from "../../../lib/echo.js";

// The real app rewrites /security.txt and /.well-known/security.txt into
// /api/security-txt from next.config.mjs, so a request the middleware sees as
// a page can reach an API handler.
export const GET = (request, context) => echo(request, context, "security-txt");
