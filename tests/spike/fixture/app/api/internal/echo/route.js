import { echo } from "../../../../lib/echo.js";

const handle = (request, context) => echo(request, context, "internal-echo");

export {
  handle as GET,
  handle as POST,
  handle as PUT,
  handle as PATCH,
  handle as DELETE,
};
