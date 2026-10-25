import { readKnowledgeFile } from "@/lib/ai/knowledge-files";
import { buildHelpText, SLASH_COMMANDS } from "@/lib/ai/commands";
import { getCategoryCounts } from "@/lib/scanner/registry";
import { CATEGORY_META } from "@/lib/scanner/category-meta";
import type { Category } from "@/lib/scanner/types";
import {
  getCheck,
  getMyAccount,
  getMyStats,
  getReleaseNotes,
  getScan,
  listMyScans,
} from "@/lib/ai/chat/tools";

/**
 * Slash commands, run on the server for the turn they are typed in.
 *
 * They used to be run by the widget, which fetched a whole knowledge file and
 * kept it in the conversation as a message. Every later turn then re-sent it:
 * one /changelog made each following question carry ~120k characters of
 * release notes to the provider, and the route needed a second, much larger
 * input budget just for those blocks, which a caller could claim by typing the
 * block's opening tag. Now the command's result rides along with the one
 * request that asked for it, and a follow-up the model needs data for is
 * answered by calling the same function as a tool.
 */

export interface SlashExpansion {
  cmd: string;
  /** Data for the model, sent as its own message just before the turn. */
  context: string;
  /** Replaces the typed command as the turn the model answers. */
  instruction: string;
}

const KNOWN = new Set(SLASH_COMMANDS.map((c) => c.cmd));

export function parseSlashCommand(
  text: string,
): { cmd: string; arg: string } | null {
  const m = /^\/([a-z-]{1,32})(?:\s+([\s\S]*))?$/i.exec(text.trim());
  if (!m) return null;
  const cmd = m[1].toLowerCase();
  if (!KNOWN.has(cmd)) return null;
  return { cmd, arg: (m[2] ?? "").trim().slice(0, 200) };
}

/** The level-2 headings of a knowledge file: one line per page or policy. */
function outline(file: string): string {
  return readKnowledgeFile("lib", "ai", file)
    .split("\n")
    .filter((l) => /^## \S/.test(l))
    .map((l) => `- ${l.slice(3).trim()}`)
    .join("\n");
}

const json = (value: unknown) => JSON.stringify(value);

export async function expandSlashCommand(
  text: string,
  userId: number,
): Promise<SlashExpansion | null> {
  const parsed = parseSlashCommand(text);
  if (!parsed) return null;
  const { cmd, arg } = parsed;
  const typed = `The reader typed "${text.trim().slice(0, 240)}".`;

  switch (cmd) {
    case "features":
      return {
        cmd,
        context: readKnowledgeFile("lib", "ai", "features-knowledge.md"),
        instruction: `${typed} Give a short overview of what VulnRadar does, grouped into a few lines with the page each lives on, then ask what they want to do.`,
      };
    case "docs":
      return {
        cmd,
        context: `Documentation pages:\n${outline("docs-knowledge.md")}`,
        instruction: `${typed} Say the documentation is available, name a few of the main topics from the outline, and ask what they need. Answer follow-ups with search_knowledge (source "docs").`,
      };
    case "checks": {
      const counts = getCategoryCounts();
      const lines = (Object.keys(CATEGORY_META) as Category[]).map(
        (k) =>
          `- ${CATEGORY_META[k].label}: ${counts[k] ?? 0} checks. ${CATEGORY_META[k].blurb}`,
      );
      return {
        cmd,
        context: `Scanner check categories:\n${lines.join("\n")}`,
        instruction: `${typed} Summarize the check categories in a few lines and ask what they want to know. Use get_check for a specific check id.`,
      };
    }
    case "changelog":
      return {
        cmd,
        context: json(getReleaseNotes(arg || undefined)),
        instruction: arg
          ? `${typed} Summarize what changed in that release in a few bullets.`
          : `${typed} Summarize what is new in the latest release in a few bullets, then offer to go through an older version.`,
      };
    case "legal":
      return {
        cmd,
        context: readKnowledgeFile("lib", "ai", "legal-knowledge.md"),
        instruction: `${typed} Say which legal pages you have (${outline(
          "legal-knowledge.md",
        )
          .split("\n")
          .map((l) => l.slice(2))
          .join(
            ", ",
          )}) and ask what they want to know. Answer only from the text.`,
      };
    case "history":
      return arg
        ? {
            cmd,
            context: json(await getScan(userId, arg)),
            instruction: `${typed} Summarize this scan: the most severe findings first, then what to fix first. Link the scan.`,
          }
        : {
            cmd,
            context: json(await listMyScans(userId, { limit: 10 })),
            instruction: `${typed} List their recent scans compactly (URL, when, worst findings) with links, and offer to open one.`,
          };
    case "me":
      return {
        cmd,
        context: json(await getMyAccount(userId)),
        instruction: `${typed} Summarize their plan and today's scan quota in one or two sentences.`,
      };
    case "stats":
      return {
        cmd,
        context: json(await getMyStats(userId)),
        instruction: `${typed} Summarize the key numbers briefly and invite a follow-up.`,
      };
    case "finding":
      return arg
        ? {
            cmd,
            context: json(getCheck(arg)),
            instruction: `${typed} Explain this check: what it means, why it matters, and how to fix it, with a short code example.`,
          }
        : {
            cmd,
            context: "",
            instruction: `${typed} They did not say which check. Ask for the check id (for example csp-missing) or the finding's title.`,
          };
    case "help":
      return {
        cmd,
        context: buildHelpText(),
        instruction: `${typed} Show the available commands from the help text.`,
      };
    default:
      return null;
  }
}
