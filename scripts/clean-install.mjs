import { execSync } from "child_process";
import { rmSync, existsSync } from "fs";
import { join } from "path";

const projectDir = "/vercel/share/v0-project";

// Remove node_modules
const nodeModules = join(projectDir, "node_modules");
if (existsSync(nodeModules)) {
  console.log("Removing node_modules...");
  rmSync(nodeModules, { recursive: true, force: true });
  console.log("node_modules removed.");
} else {
  console.log("No node_modules found.");
}

// Remove .next cache
const nextCache = join(projectDir, ".next");
if (existsSync(nextCache)) {
  console.log("Removing .next cache...");
  rmSync(nextCache, { recursive: true, force: true });
  console.log(".next cache removed.");
} else {
  console.log("No .next cache found.");
}

// Run pnpm install
console.log("Running pnpm install...");
try {
  execSync("pnpm install --no-frozen-lockfile", {
    cwd: projectDir,
    stdio: "inherit",
    env: { ...process.env, NODE_ENV: "development" },
  });
  console.log("pnpm install completed successfully.");
} catch (e) {
  console.error("pnpm install failed:", e.message);
}

// Verify lucide-react
const lucidePath = join(projectDir, "node_modules", "lucide-react", "package.json");
if (existsSync(lucidePath)) {
  const pkg = JSON.parse((await import("fs")).readFileSync(lucidePath, "utf8"));
  console.log("lucide-react installed version:", pkg.version);
} else {
  console.log("WARNING: lucide-react not found after install!");
}
