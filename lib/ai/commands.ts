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
  const lines = [
    "**Available slash commands:**\n",
    ...SLASH_COMMANDS.map((c) => {
      const usage = c.args ? `\`/${c.cmd} ${c.args}\`` : `\`/${c.cmd}\``;
      const lock = c.requiresAuth ? " *(sign in required)*" : "";
      return `${usage} — ${c.description}${lock}`;
    }),
    "\nType `/` in the chat input to see autocomplete suggestions.",
  ];
  return lines.join("\n");
}
