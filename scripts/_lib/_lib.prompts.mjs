/**
 * VulnRadar — Interactive prompts.
 *
 * Three flavours: free-form ask, yes/no with default, and danger (red, no
 * default). All read from stdin and handle EOF gracefully.
 */

import * as readline from "node:readline";
import { c, warn, error } from "./_lib.output.mjs";

function rawQuestion(prompt) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

export async function ask(question, defaultVal = "") {
  const hint = defaultVal ? ` ${c.dim}(${defaultVal})${c.reset}` : "";
  const answer = await rawQuestion(`${c.cyan}?${c.reset} ${question}${hint} `);
  return answer.trim() || defaultVal;
}

export async function askYesNo(question, defaultYes = false) {
  const hint = defaultYes
    ? `${c.dim}(Y/n)${c.reset}`
    : `${c.dim}(y/N)${c.reset}`;
  const answer = (
    await rawQuestion(`${c.cyan}?${c.reset} ${question} ${hint} `)
  )
    .trim()
    .toLowerCase();
  if (answer === "") return defaultYes;
  return answer === "y" || answer === "yes";
}

export async function askDanger(question) {
  const answer = (
    await rawQuestion(
      `${c.red}?${c.reset} ${question} ${c.dim}(y/N)${c.reset} `,
    )
  )
    .trim()
    .toLowerCase();
  return answer === "y" || answer === "yes";
}

/**
 * Ask the user to type an exact phrase to confirm. Used for destructive
 * downgrades where we want a higher bar than y/n.
 *
 * - Typing the required phrase exactly → true
 * - Typing "n" or "no" (case-insensitive) → false (cancel)
 * - Pressing Enter or typing anything else → re-asks (so a slip of the
 *   fingers doesn't abort a critical operation)
 *
 * @param {string} question  — the question to display
 * @param {string} required  — the exact phrase they must type
 * @returns {Promise<boolean>}
 */
export async function askExact(question, required) {
  const prompt = `${c.red}?${c.reset} ${question} `;
  while (true) {
    const answer = (await rawQuestion(prompt)).trim();
    const lower = answer.toLowerCase();
    if (
      lower === "n" ||
      lower === "no" ||
      lower === "cancel" ||
      lower === "q"
    ) {
      return false;
    }
    if (answer === required) {
      return true;
    }
    if (answer === "") {
      warn(
        `  ${c.dim}Please type ${c.bold}${required}${c.reset}${c.dim} to confirm, or 'n' to cancel.${c.reset}`,
      );
    } else {
      warn(
        `  ${c.dim}Didn't match. Type ${c.bold}${required}${c.reset}${c.dim} to confirm, or 'n' to cancel.${c.reset}`,
      );
    }
  }
}

// Keep these two re-exports so the barrel's surface doesn't change.
export { warn, error };
