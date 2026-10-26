import { echo } from "../../../../lib/echo.js";

export const GET = (request, context) =>
  echo(request, context, "internal-static-sibling");
