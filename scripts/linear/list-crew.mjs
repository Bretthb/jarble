#!/usr/bin/env node
// Prints active Linear users in a table so Brett can paste the UUIDs into .claude/crew.json.
// Usage: LINEAR_API_KEY=lin_api_... node scripts/linear/list-crew.mjs

import { linearApiKey, listUsers } from "./graphql-client.mjs";

if (!linearApiKey()) {
  console.error("LINEAR_API_KEY is not set. Export it and re-run.");
  process.exit(1);
}

const users = await listUsers();
if (users.length === 0) {
  console.error("No users returned — check that LINEAR_API_KEY is valid.");
  process.exit(1);
}

const rows = users
  .map((u) => ({
    name: u.name || "",
    displayName: u.displayName || "",
    email: u.email || "",
    linearUserId: u.id,
  }))
  .sort((a, b) => a.name.localeCompare(b.name));

const nameW  = Math.max(4,  ...rows.map((r) => r.name.length));
const dispW  = Math.max(7,  ...rows.map((r) => r.displayName.length));
const emailW = Math.max(5,  ...rows.map((r) => r.email.length));
const idW    = Math.max(14, ...rows.map((r) => r.linearUserId.length));

const pad = (s, w) => s.padEnd(w, " ");

console.log(pad("Name", nameW) + "  " + pad("Display", dispW) + "  " + pad("Email", emailW) + "  " + pad("Linear User Id", idW));
console.log("-".repeat(nameW + dispW + emailW + idW + 6));
for (const r of rows) {
  console.log(pad(r.name, nameW) + "  " + pad(r.displayName, dispW) + "  " + pad(r.email, emailW) + "  " + pad(r.linearUserId, idW));
}

console.log("\nPaste the relevant ids into .claude/crew.json `crew[].linearUserId`.");
