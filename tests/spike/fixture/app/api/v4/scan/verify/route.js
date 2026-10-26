import { echo } from "../../../../../lib/echo.js";

// Same literal the real routes declare. The harness reads the build manifest
// to see whether Next picked it up for this file.
export const maxDuration = 1140;

const handle = (request, context) => echo(request, context, "v4-scan-verify");

export { handle as GET, handle as POST };
