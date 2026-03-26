#!/usr/bin/env node
/**
 * PreToolUse hook: Runs both typechecks before git commit.
 * Catches cross-project breakage from the Zod v3/v4 split.
 * Only triggers when the Bash command contains "git commit".
 */
const { execSync } = require("child_process");

const input = process.env.TOOL_INPUT || "";

// Only intercept git commit commands
if (!input.includes("git commit")) {
  process.exit(0);
}

const errors = [];

try {
  execSync("npx tsc --noEmit", { cwd: "jarble-api-main", stdio: "pipe", timeout: 60000 });
} catch (err) {
  const output = (err.stdout || "").toString().split("\n").slice(-10).join("\n");
  errors.push(`API typecheck failed:\n${output}`);
}

try {
  execSync("npx tsc --noEmit", { cwd: "Jarble-mvp", stdio: "pipe", timeout: 60000 });
} catch (err) {
  const output = (err.stdout || "").toString().split("\n").slice(-10).join("\n");
  errors.push(`Frontend typecheck failed:\n${output}`);
}

if (errors.length > 0) {
  // Output blocking message — Claude Code will show this and block the commit
  console.log(JSON.stringify({
    decision: "block",
    reason: `Typecheck failed — fix before committing:\n\n${errors.join("\n\n")}`
  }));
  process.exit(0);
}

// All clear
process.exit(0);
