import { echo } from "../../../../lib/echo.js";

// Reached only if the control rewrite stayed on this server instead of being
// proxied to the recording listener.
export const GET = (request, context) =>
  echo(request, context, "control-target-local");
export const POST = GET;
