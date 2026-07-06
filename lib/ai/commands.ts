export type SlashCommand = {
  cmd: string;
  args?: string;
  description: string;
  requiresAuth: boolean;
  example?: string;
};

export const SLASH_COMMANDS: SlashCommand[] = [
  {
    cmd: "docs",
    description: "Load documentation context",
    requiresAuth: false,
  },
  {
    cmd: "changelog",
    description: "Load recent release notes",
    requiresAuth: false,
  },
  {
    cmd: "checks",
    description: "Load all 700+ scanner checks index",
    requiresAuth: false,
  },
  { cmd: "history", description: "List your recent scans", requiresAuth: true },
  {
    cmd: "history",
    args: "[id]",
    description: "Load a specific scan by ID",
    requiresAuth: true,
    example: "/history 123",
  },
  { cmd: "me", description: "Load your account info", requiresAuth: true },
  {
    cmd: "finding",
    args: "[id]",
    description: "Explain a specific finding type",
    requiresAuth: false,
    example: "/finding csp-missing",
  },
  {
    cmd: "stats",
    description: "Your scan statistics and usage",
    requiresAuth: true,
  },
  { cmd: "help", description: "Show available commands", requiresAuth: false },
];

export function buildHelpText(): string {
  return `**Slash commands**

**Context loaders** — load info Vera can use to answer your questions:
- \`/docs\` — VulnRadar documentation and setup guides
- \`/changelog\` — Recent release notes
- \`/checks\` — All 700+ scanner check descriptions
- \`/finding [id]\` — Explain a specific finding (e.g. \`/finding csp-missing\`)

**Your account:**
- \`/me\` — Account info
- \`/history\` — Recent scans list
- \`/history [id]\` — A specific scan result
- \`/stats\` — Scan statistics and usage

Type \`/\` in the input to see autocomplete.`;
}
