import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface CheckPage {
  id: string;
  title: string;
  severity: string;
  description: string;
  evidence: string;
  riskImpact?: string;
  explanation?: string;
  fixSteps: string[];
  codeExamples: { label: string; language: string; code: string }[];
  file: string;
}

const CHECKS_DIR = join(process.cwd(), "lib", "scanner", "checks-data");

export function loadCheckPages(): CheckPage[] {
  return readdirSync(CHECKS_DIR)
    .filter((f) => f.endsWith(".json"))
    .flatMap((file) =>
      (
        JSON.parse(readFileSync(join(CHECKS_DIR, file), "utf8")) as Omit<
          CheckPage,
          "file"
        >[]
      ).map((check) => ({ ...check, file })),
    );
}

export const GENERATED_FILLER =
  /check verifies that the server does not expose|detection runs against the response headers, body, or auxiliary probes/i;

const countWords = (text: string) =>
  text.trim().split(/\s+/).filter(Boolean).length;

/**
 * Words of prose a reader of /checks/<id> gets. Each distinct paragraph counts
 * once: 117 pages shipped an explanation identical to their description, and a
 * fix step repeated as the risk is not two things to read. Code samples do not
 * count, because a page can be nothing but a snippet and still explain nothing.
 */
export function pageProseWords(
  page: Pick<
    CheckPage,
    "description" | "riskImpact" | "explanation" | "fixSteps"
  >,
): number {
  const paragraphs = new Set(
    [
      page.description,
      page.riskImpact,
      page.explanation,
      ...page.fixSteps,
    ].filter((text): text is string =>
      Boolean(text && !GENERATED_FILLER.test(text)),
    ),
  );
  let total = 0;
  for (const text of paragraphs) total += countWords(text);
  return total;
}
