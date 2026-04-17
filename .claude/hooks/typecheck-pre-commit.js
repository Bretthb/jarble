#!/usr/bin/env node
/**
 * PreToolUse hook: Runs both typechecks before git commit.
 * Catches cross-project breakage from the Zod v3/v4 split.
 * Only triggers when the Bash command contains "git commit".
 * Also enforces CLAUDE.md commit format by blocking if the message is missing (JAR-XX)
 * while the current branch matches jar-\d+. Set SKIP_JAR_TAG=1 to bypass.
 */
const { execSync } = require("child_process");

const input = process.env.TOOL_INPUT || "";

// Only intercept git commit commands
if (!input.includes("git commit")) {
  process.exit(0);
}

// Enforce (JAR-XX) tag on commits authored from a jar-XX branch.
if (process.env.SKIP_JAR_TAG !== "1") {
  let branch = "";
  try {
    branch = execSync("git rev-parse --abbrev-ref HEAD", { stdio: ["ignore", "pipe", "ignore"], encoding: "utf8" }).trim();
  } catch {}
  const branchMatch = branch.match(/\bjar-(\d+)/i);
  if (branchMatch) {
    const expected = `JAR-${branchMatch[1]}`;
    if (!new RegExp(`\\(${expected}\\)`, "i").test(input)) {
      console.log(JSON.stringify({
        decision: "block",
        reason: `Commit message is missing the ${expected} tag. Re-run the commit with \`(${expected})\` appended to the message (e.g. \`Fix login (JAR-${branchMatch[1]})\`). Set SKIP_JAR_TAG=1 in the command to bypass.`
      }));
      process.exit(0);
    }
  }
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
