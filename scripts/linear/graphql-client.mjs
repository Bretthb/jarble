#!/usr/bin/env node
// Shared Linear GraphQL client. Used by hooks, /dispatch-roadmap, and nightly-sync.
// All functions return plain objects or null on failure — never throw. Callers decide how to handle a null.
//
// Environment: requires LINEAR_API_KEY. Team key defaults to JAR (override via LINEAR_TEAM_KEY).

const ENDPOINT = "https://api.linear.app/graphql";
const TEAM_KEY = process.env.LINEAR_TEAM_KEY || "JAR";

export function linearApiKey() {
  return process.env.LINEAR_API_KEY || "";
}

/**
 * Low-level GraphQL request. Returns parsed JSON `data` or null.
 * Safe to call without a key — returns null if LINEAR_API_KEY is unset.
 */
export async function linearRequest(query, variables = {}) {
  const key = linearApiKey();
  if (!key) return null;
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Authorization": key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, variables }),
    });
    if (!res.ok) return null;
    const json = await res.json();
    if (json.errors) return null;
    return json.data ?? null;
  } catch {
    return null;
  }
}

/** Fetch an issue by its human-readable identifier, e.g. "JAR-12". */
export async function getIssueByIdentifier(identifier) {
  const data = await linearRequest(
    `query($id:String!){
       issue(id:$id){
         id identifier title description priority state{name}
         assignee{id name email} labels{nodes{id name}}
         parent{id identifier title}
         url
       }
     }`,
    { id: identifier },
  );
  return data?.issue ?? null;
}

/** List open issues in the team, optionally filtered by assignee UUID and states. */
export async function listOpenIssues({ assigneeId = null, states = ["In Progress", "In Review", "Todo", "Backlog"] } = {}) {
  const stateFilter = states.length ? `state: { name: { in: ${JSON.stringify(states)} } }` : "";
  const assigneeFilter = assigneeId ? `assignee: { id: { eq: "${assigneeId}" } }` : "";
  const filterParts = [`team: { key: { eq: "${TEAM_KEY}" } }`, stateFilter, assigneeFilter].filter(Boolean).join(", ");
  const data = await linearRequest(
    `query {
       issues(first: 100, filter: { ${filterParts} }) {
         nodes {
           id identifier title priority url
           state { name }
           assignee { id name email }
           labels { nodes { name } }
           updatedAt createdAt
         }
       }
     }`,
  );
  return data?.issues?.nodes ?? [];
}

/** Count open issues for a given assignee. Used by load-balance check. */
export async function countOpenIssuesForAssignee(assigneeId) {
  const issues = await listOpenIssues({ assigneeId });
  return issues.length;
}

/** Resolve the team UUID for TEAM_KEY. Cached on module scope. */
let _teamIdCache = null;
export async function getTeamId() {
  if (_teamIdCache) return _teamIdCache;
  const data = await linearRequest(
    `query($key:String!){ teams(filter:{ key:{ eq:$key } }, first:1){ nodes{ id } } }`,
    { key: TEAM_KEY },
  );
  _teamIdCache = data?.teams?.nodes?.[0]?.id ?? null;
  return _teamIdCache;
}

/** Fetch all workflow states for the team — used to map "In Progress" → state id. */
let _statesCache = null;
export async function getWorkflowStates() {
  if (_statesCache) return _statesCache;
  const teamId = await getTeamId();
  if (!teamId) return [];
  const data = await linearRequest(
    `query($teamId:String!){ workflowStates(filter:{ team:{ id:{ eq:$teamId } } }, first:50){ nodes{ id name type } } }`,
    { teamId },
  );
  _statesCache = data?.workflowStates?.nodes ?? [];
  return _statesCache;
}

export async function getStateIdByName(name) {
  const states = await getWorkflowStates();
  const lower = name.toLowerCase();
  return states.find((s) => s.name.toLowerCase() === lower)?.id ?? null;
}

/** Map priority string → Linear numeric priority. Unknown → 0 (no priority). */
export function priorityToNumber(p) {
  switch ((p || "").toLowerCase()) {
    case "urgent": return 1;
    case "high":   return 2;
    case "medium": return 3;
    case "low":    return 4;
    default:       return 0;
  }
}

/** List all users in the workspace. Used by list-crew.mjs. */
export async function listUsers() {
  const data = await linearRequest(
    `query { users(first: 250) { nodes { id name displayName email active } } }`,
  );
  return data?.users?.nodes?.filter((u) => u.active) ?? [];
}

/** Fetch label ids by name. Creates missing labels is intentionally NOT done here — callers see a warning. */
export async function resolveLabelIds(names) {
  if (!names || names.length === 0) return [];
  const teamId = await getTeamId();
  if (!teamId) return [];
  const data = await linearRequest(
    `query($teamId:String!){ issueLabels(filter:{ team:{ id:{ eq:$teamId } } }, first:250){ nodes{ id name } } }`,
    { teamId },
  );
  const all = data?.issueLabels?.nodes ?? [];
  const byName = new Map(all.map((l) => [l.name.toLowerCase(), l.id]));
  return names.map((n) => byName.get(n.toLowerCase())).filter(Boolean);
}

/** Create an issue. Returns the created issue or null. */
export async function createIssue({ title, description, assigneeId, labelIds = [], priority = 0, parentId = null, projectId = null }) {
  const teamId = await getTeamId();
  if (!teamId) return null;
  const input = {
    title,
    description,
    teamId,
    priority,
    ...(assigneeId ? { assigneeId } : {}),
    ...(labelIds.length ? { labelIds } : {}),
    ...(parentId ? { parentId } : {}),
    ...(projectId ? { projectId } : {}),
  };
  const data = await linearRequest(
    `mutation($input:IssueCreateInput!){
       issueCreate(input:$input){
         success
         issue{ id identifier title url }
       }
     }`,
    { input },
  );
  if (!data?.issueCreate?.success) return null;
  return data.issueCreate.issue;
}

/** Post a comment on an issue. `issueId` is the UUID (not identifier). */
export async function commentOnIssue(issueId, body) {
  const data = await linearRequest(
    `mutation($id:String!,$body:String!){
       commentCreate(input:{ issueId:$id, body:$body }){ success comment{ id } }
     }`,
    { id: issueId, body },
  );
  return data?.commentCreate?.success === true;
}

/** Transition an issue to a state by name (e.g. "In Progress"). No-op if state not found. */
export async function updateIssueState(issueId, stateName) {
  const stateId = await getStateIdByName(stateName);
  if (!stateId) return false;
  const data = await linearRequest(
    `mutation($id:String!,$stateId:String!){
       issueUpdate(id:$id, input:{ stateId:$stateId }){ success }
     }`,
    { id: issueId, stateId },
  );
  return data?.issueUpdate?.success === true;
}

/** Link two issues with a blocks/blocked-by relationship. */
export async function addBlockingRelation({ blockerId, blockedId }) {
  const data = await linearRequest(
    `mutation($input:IssueRelationCreateInput!){
       issueRelationCreate(input:$input){ success }
     }`,
    { input: { issueId: blockedId, relatedIssueId: blockerId, type: "blocks" } },
  );
  return data?.issueRelationCreate?.success === true;
}
