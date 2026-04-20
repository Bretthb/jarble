#!/usr/bin/env node
/**
 * PreToolUse hook: scans staged content for known secret patterns before a
 * git commit lands them on disk. Blocks the commit if a match is found.
 *
 * Wired in .claude/settings.json under PreToolUse → Bash. Only intercepts
 * `git commit` / `git commit -m` commands — other Bash calls pass through.
 *
 * Patterns are deliberately narrow prefixes to minimise false positives.
 * Escape hatch: set SKIP_SECRET_SCAN=1 to bypass (mirrors SKIP_JAR_TAG).
 *
 * Added for JAR-33 after two live tokens (Sentry + Vercel) were committed
 * to .claude/settings.json and had to be rotated out-of-band.
 */
const { execSync } = require("child_process");

const input = process.env.TOOL_INPUT || "";

// Only intercept git commit commands — the moment tracked content enters
// history. `git add` without commit is cheap to undo; commit is not.
if (!/\bgit\s+commit\b/.test(input)) {
  process.exit(0);
}

if (process.env.SKIP_SECRET_SCAN === "1") {
  process.exit(0);
}

// Prefix patterns for well-known token formats. Each entry: [label, regex].
// Keep the regex anchored to the token's distinctive prefix so random hex
// blobs in test fixtures don't trip the scanner.
const PATTERNS = [
  ["Sentry user auth token", /\bsntryu_[A-Za-z0-9]{40,}\b/],
  ["Vercel personal token", /\bvcp_[A-Za-z0-9]{24,}\b/],
  ["Anthropic API key", /\bsk-ant-api03-[A-Za-z0-9_-]{20,}\b/],
  ["OpenAI API key", /\bsk-(?:proj-)?[A-Za-z0-9]{20,}\b/],
  ["Stripe secret key", /\bsk_(?:live|test)_[A-Za-z0-9]{24,}\b/],
  ["Stripe webhook secret", /\bwhsec_[A-Za-z0-9]{24,}\b/],
  ["GitHub personal token", /\bghp_[A-Za-z0-9]{30,}\b/],
  ["GitHub OAuth token", /\bgho_[A-Za-z0-9]{30,}\b/],
  ["Slack bot token", /\bxoxb-[0-9A-Za-z-]{20,}\b/],
  ["Slack user token", /\bxoxp-[0-9A-Za-z-]{20,}\b/],
  ["AWS access key ID", /\bAKIA[0-9A-Z]{16}\b/],
  ["Google API key", /\bAIza[0-9A-Za-z_-]{35}\b/],
  ["OpenRouter API key", /\bsk-or-v1-[A-Za-z0-9]{20,}\b/],
  ["PEM private key", /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/],
  ["Linear API key", /\blin_api_[A-Za-z0-9]{30,}\b/],
];

// Grab the staged diff. --cached so we only look at what's about to be
// committed, not tracked-but-unstaged changes. No --unified=0 because
// context is useful for the hook message.
let diff = "";
try {
  diff = execSync("git diff --cached", {
    stdio: ["ignore", "pipe", "ignore"],
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024,
  });
} catch {
  // If we can't get the diff (e.g. no repo, no staged changes), let the
  // commit through — the typecheck hook will surface real problems.
  process.exit(0);
}

if (!diff.trim()) {
  process.exit(0);
}

const hits = [];
// Only scan added lines so a commit that REMOVES a leaked secret isn't
// blocked by its own fix.
const addedLines = diff.split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++"));
const addedBlob = addedLines.join("\n");

for (const [label, regex] of PATTERNS) {
  const match = addedBlob.match(regex);
  if (match) {
    hits.push({ label, sample: match[0].slice(0, 12) + "…" });
  }
}

if (hits.length > 0) {
  const lines = hits.map((h) => `  • ${h.label} (starts with ${h.sample})`).join("\n");
  console.log(JSON.stringify({
    decision: "block",
    reason: `Staged changes contain what look like real secrets — refusing to let you commit them.\n\n${lines}\n\nMove the secret to an untracked file (.claude/settings.local.json, jarble-api-main/.env) and reference it via an env var. If this is a false positive, set SKIP_SECRET_SCAN=1 in the command to bypass.`,
  }));
  process.exit(0);
}

process.exit(0);
