import { slowStream } from "../../../../../../lib/echo.js";

// Stands for the CSV stream of audit-log/export.
export function GET() {
  return slowStream({
    lines: 8,
    gapMs: 300,
    contentType: "text/csv; charset=utf-8",
    route: "internal-audit-export",
    extraHeaders: {
      "content-disposition": 'attachment; filename="audit-log.csv"',
    },
    makeLine: (i) => (i === 0 ? "id,at,actor\n" : `${i},${Date.now()},spike\n`),
  });
}
