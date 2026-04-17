#!/usr/bin/env node
// Claude Code Stop hook — posts a Linear comment summarizing commits made this session.
// Silent no-op when LINEAR_API_KEY is unset, branch has no JAR-XX, or no new commits.

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const LINEAR_API_KEY = process.env.LINEAR_API_KEY;
if (!LINEAR_API_KEY) process.exit(0);

const sh = (cmd) => {
  try {
    return execSync(cmd, { stdio: ["ignore", "pipe", "ignore"], encoding: "utf8" }).trim();
  } catch {
    return "";
  }
};

const repoRoot = sh("git rev-parse --show-toplevel");
if (!repoRoot) process.exit(0);
process.chdir(repoRoot);

const branch = sh("git rev-parse --abbrev-ref HEAD");
if (!branch) process.exit(0);

const issueMatch = branch.match(/\bjar-(\d+)/i);
if (!issueMatch) process.exit(0);
const issueId = `JAR-${issueMatch[1]}`;

const markerDir = join(process.env.XDG_CACHE_HOME || join(homedir(), ".cache"), "jarble-linear-hooks");
try { mkdirSync(markerDir, { recursive: true }); } catch { process.exit(0); }
const markerFile = join(markerDir, `${issueId}__${branch.replace(/[\/\\]/g, "_")}.head`);

const currentHead = sh("git rev-parse HEAD");
if (!currentHead) process.exit(0);

let lastHead = "";
if (existsSync(markerFile)) {
  try { lastHead = readFileSync(markerFile, "utf8").trim(); } catch {}
}
if (currentHead === lastHead) process.exit(0);

let base = "";
if (lastHead && sh(`git cat-file -e ${lastHead}^{commit} 2>/dev/null && echo ok`) === "ok") {
  base = lastHead;
} else {
  base = sh("git merge-base HEAD develop");
}

const writeMarker = () => { try { writeFileSync(markerFile, currentHead); } catch {} };

if (!base || base === currentHead) { writeMarker(); process.exit(0); }

const commits = sh(`git log --pretty=format:"- %s (%h)" ${base}..HEAD`);
if (!commits) { writeMarker(); process.exit(0); }

const stat = sh(`git diff --shortstat ${base}..HEAD`);
const prUrl = sh(`gh pr list --head "${branch}" --json url --jq ".[0].url // \\"\\""`) || "";

let body = `**Claude Code session update** (branch \`${branch}\`)\n\nCommits:\n${commits}`;
if (stat) body += `\n\n${stat}`;
if (prUrl) body += `\n\nPR: ${prUrl}`;

const gql = async (query, variables) => {
  const res = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: { "Authorization": LINEAR_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) return null;
  const json = await res.json();
  return json?.data ?? null;
};

try {
  const lookup = await gql("query($id:String!){issue(id:$id){id}}", { id: issueId });
  const uuid = lookup?.issue?.id;
  if (!uuid) { writeMarker(); process.exit(0); }

  await gql(
    "mutation($id:String!,$body:String!){commentCreate(input:{issueId:$id,body:$body}){success}}",
    { id: uuid, body }
  );
} catch {
  // swallow — hook must never fail the session
}

writeMarker();
process.exit(0);
