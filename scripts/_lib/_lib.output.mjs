/**
 * VulnRadar — Terminal output helpers.
 *
 * Coloured logs, banner, section headers. Pure functions, no I/O.
 */

export const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
  white: "\x1b[37m",
  bgRed: "\x1b[41m",
  bgGreen: "\x1b[42m",
  bgYellow: "\x1b[43m",
  bgCyan: "\x1b[46m",
};

export const log = (msg) => console.log(msg);
export const info = (msg) => log(`${c.cyan}[INFO]${c.reset} ${msg}`);
export const success = (msg) => log(`${c.green}[OK]${c.reset}   ${msg}`);
export const warn = (msg) => log(`${c.yellow}[WARN]${c.reset} ${msg}`);
export const error = (msg) => log(`${c.red}[ERR]${c.reset}  ${msg}`);

/**
 * Compute the visible length of a string (excluding ANSI escape codes).
 * Used to build box-drawing borders that align regardless of color codes.
 */
function visibleLength(s) {
  return s.replace(/\x1b\[[0-9;]*m/g, "").length;
}

export function banner(title, subtitle) {
  const innerWidth = Math.max(
    visibleLength(title),
    subtitle ? visibleLength(subtitle) : 0,
  );
  const horizontal = "═".repeat(innerWidth + 4);
  const top = `  ╔${horizontal}╗`;
  const bot = `  ╚${horizontal}╝`;
  // Pad with spaces AFTER the styled title/subtitle so the right border ║
  // stays inside the cyan color span (not white/default).
  const titleLine = `  ║  ${c.bold}${title}${c.reset}${" ".repeat(
    Math.max(0, innerWidth - title.length),
  )}  ║`;
  const subLine = subtitle
    ? `  ║  ${c.dim}${subtitle}${c.reset}${" ".repeat(
        Math.max(0, innerWidth - subtitle.length),
      )}  ║`
    : null;

  log("");
  log(`${c.bold}${c.cyan}${top}${c.reset}`);
  log(`${c.cyan}${titleLine}${c.reset}`);
  if (subLine) log(`${c.cyan}${subLine}${c.reset}`);
  log(`${c.bold}${c.cyan}${bot}${c.reset}`);
  log("");
}

export function section(title) {
  log("");
  log(
    `${c.bold}─── ${title} ${"─".repeat(Math.max(0, 60 - title.length))}${c.reset}`,
  );
  log("");
}

/**
 * Draw a red-bordered box containing one or more lines. Used for loud
 * warnings (destructive downgrades, etc.) so the user can't miss them.
 *
 * @param {string | string[]} headline  — first line(s), rendered bold + bright red
 * @param {string[]} body              — additional lines, rendered red
 */
export function warningBox(headline, body = []) {
  const headlines = Array.isArray(headline) ? headline : [headline];
  const allLines = [...headlines, ...body];

  // Compute the inner width (visible chars, ignoring ANSI).
  const innerWidth = Math.max(...allLines.map(visibleLength));
  const boxWidth = innerWidth + 2; // 1 space padding on each side
  const horiz = "═".repeat(boxWidth);
  const top = `  ╔${horiz}╗`;
  const bot = `  ╚${horiz}╝`;

  log("");
  log(`${c.bold}${c.red}${top}${c.reset}`);
  for (let i = 0; i < headlines.length; i++) {
    const line = headlines[i];
    const pad = " ".repeat(Math.max(0, innerWidth - visibleLength(line)));
    log(
      `${c.red}  ║ ${c.bold}${c.bgRed}${line}${c.reset}${c.red}${pad} ║${c.reset}`,
    );
  }
  for (const line of body) {
    const pad = " ".repeat(Math.max(0, innerWidth - visibleLength(line)));
    log(`${c.red}  ║ ${line}${pad} ║${c.reset}`);
  }
  log(`${c.bold}${c.red}${bot}${c.reset}`);
  log("");
}

/**
 * Draw a yellow/cyan informational box (less alarming than warningBox).
 */
export function infoBox(headline, body = []) {
  const headlines = Array.isArray(headline) ? headline : [headline];
  const allLines = [...headlines, ...body];

  const innerWidth = Math.max(...allLines.map(visibleLength));
  const boxWidth = innerWidth + 2;
  const horiz = "─".repeat(boxWidth);
  const top = `  ╭${horiz}╮`;
  const bot = `  ╰${horiz}╯`;

  log("");
  log(`${c.cyan}${top}${c.reset}`);
  for (const line of headlines) {
    const pad = " ".repeat(Math.max(0, innerWidth - visibleLength(line)));
    log(`${c.cyan}  │ ${c.bold}${line}${c.reset}${c.cyan}${pad} │${c.reset}`);
  }
  for (const line of body) {
    const pad = " ".repeat(Math.max(0, innerWidth - visibleLength(line)));
    log(`${c.cyan}  │ ${line}${pad} │${c.reset}`);
  }
  log(`${c.cyan}${bot}${c.reset}`);
  log("");
}
