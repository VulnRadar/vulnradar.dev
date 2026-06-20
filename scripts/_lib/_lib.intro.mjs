/**
 * VulnRadar — Top-of-script confirmation gate.
 *
 * Prints a structured "what this script will do" panel and asks the user to
 * confirm before proceeding. Pass `destructive: true` to swap the prompt for
 * the red danger variant.
 */

import { c, log, banner } from "./_lib.output.mjs";
import { askYesNo, askDanger } from "./_lib.prompts.mjs";

/**
 * @param {object} opts
 * @param {string} opts.title        — e.g. "Run database migration"
 * @param {string} opts.tagline      — one-line description
 * @param {string[]} opts.steps      — ordered list of what will happen
 * @param {string[]} opts.warnings   — optional list of caveats
 * @param {boolean} [opts.destructive]
 * @param {string} [opts.target]     — e.g. "db 'vulnradar' on localhost"
 * @returns {Promise<boolean>}
 */
export async function confirmIntro({
  title,
  tagline,
  steps,
  warnings = [],
  destructive = false,
  target,
}) {
  banner(title, tagline);

  if (target) {
    log(`  ${c.dim}Target:${c.reset}  ${c.bold}${target}${c.reset}`);
    log("");
  }

  if (steps?.length) {
    log(`  ${c.bold}What this script will do:${c.reset}`);
    for (const step of steps) log(`    ${c.cyan}•${c.reset} ${step}`);
    log("");
  }

  if (warnings.length) {
    const prefix = destructive ? c.red : c.yellow;
    const label = destructive ? "Destructive operations" : "Heads up";
    log(`  ${prefix}${c.bold}${label}:${c.reset}`);
    for (const w of warnings) log(`    ${prefix}!${c.reset} ${w}`);
    log("");
  }

  const confirmFn = destructive ? askDanger : askYesNo;
  const prompt = destructive
    ? "Proceed? This is a destructive operation."
    : "Proceed?";
  return confirmFn(prompt, !destructive);
}
