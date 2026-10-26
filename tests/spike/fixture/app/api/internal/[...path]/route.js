import { echo } from "../../../../lib/echo.js";

// The catch-all that turns an alias to a file that does not exist into a 404.
const handle = (request, context) =>
  echo(request, context, "internal-catch-all", { status: 404 });

export {
  handle as GET,
  handle as POST,
  handle as PUT,
  handle as PATCH,
  handle as DELETE,
};
