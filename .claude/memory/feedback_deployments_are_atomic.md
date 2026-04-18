---
name: Fractal deployments — teams are zoomed-out deployments
description: Core product vision — every deployment is both atomic AND composable. The same chat/canvas interface applies at every level of the orchestration tree
type: feedback
---

## One-line architecture

**"Clusters talking to clusters in a team — where each cluster is a runtime + its subagents."** (founder's framing, 2026-04-08)

A runtime without subagents is still a cluster — just a "cluster of one" (the runtime itself). A runtime with N subagents is a cluster of N+1 capabilities running in one pod. A team is the flow graph connecting multiple clusters that talk to each other over the network via `chatViaExec` / gateway.

Marketing pitch: **"Build teams of AI clusters. Each cluster runs on its own machine with its own memory and its own specialists. Clusters collaborate by talking to each other, just like humans."**

## Scope hierarchy (important: two distinct levels of "sub-agents")

There are **multiple scopes** inside Jarble and they are NOT interchangeable. The cleanest way to think about them: **"a runtime with subagents is a cluster; a team is a cluster of clusters"** (founder's framing).

1. **Runtime scope** — a deployment is a runtime (OpenClaw) running in one K8s pod with one Longhorn PVC. One process, one model, one memory store. This is the atomic unit.

2. **Individual deployment scope (internal orchestration / cluster)** — the runtime plus its **subagents** (internal helpers that run INSIDE the same pod as the runtime). This is "internal orchestration": the runtime is the cluster manager, subagents are the cluster workers, and dispatch is in-process. They share memory (`/data`), CPU/RAM budget, LLM provider key, and — when the runtime hands off — the context window. A deployment with subagents still looks and feels like ONE thing — one chat, one canvas, one `/d/[id]` URL — because from the outside it IS one thing that internally farms work to its own cluster.

3. **Team scope (external orchestration)** — multiple **individual deployments** (each one its own cluster) wired together into an orchestration graph (a flow). Teammates are NOT subagents: they are independent deployments in their own pods on their own nodes with their own PVCs and their own memory. Cross-pod calls, independent billing, independent scaling. The team flow is the higher-order orchestration that wires them across pod boundaries.

4. **Team-of-teams scope (fractal zoom-out)** — a deployment that is itself a team's entry point can ALSO be a specialist teammate inside a larger team. That larger team is a cluster-of-clusters-of-clusters. The fractal.

**Critical distinction — internal vs external orchestration:**

| | Internal (runtime → subagents) | External (deployment ↔ teammate deployment) |
|---|---|---|
| Mechanism | In-process dispatch | Cross-pod RPC via `chatViaExec` / gateway |
| Memory sharing | Yes — shared pod `/data` and context window | No — teammates share nothing unless explicitly passed via delegation args |
| Billing | Rolls up to ONE deployment line item | Each teammate bills independently |
| Fault tolerance | Crashed subagent degrades parent deployment (same pod) | Crashed teammate leaves the team with a gap but others keep running |
| Latency | Low (in-process) | Higher (network hop + cold context) |
| Trust boundary | Full trust — shared process | Explicit boundaries — args must be sanitized across |

Features must treat these two levels differently even though the user-facing chat/canvas surface is identical. Memory scoping lives at the pod boundary; cross-pod communication is explicit by design and mirrors how humans collaborate: coworkers share work through meetings (explicit handoffs), not by reading each other's minds.

**Implications that must be preserved when designing features:**
- **Subagents ≠ teammates.** A deployment's subagents are an internal implementation detail of that deployment; teammates are peers in an orchestration graph. Don't conflate them in UI or data models.
- **Capabilities compose by scope:** runtime capabilities + subagent skills = individual deployment capability; union of member deployment capabilities = team capability.
- **Memory scope follows the pod boundary by default:** subagents share memory with their parent runtime; teammates do not share memory with each other unless the team explicitly passes it via flow results.
- **Billing rolls up but respects boundaries:** subagent compute charges to the parent deployment; teammate compute charges each teammate independently and rolls up to the team view for display.
- **Failure isolation:** a crashed teammate does NOT kill the parent team; a crashed subagent DOES degrade its parent deployment.
- **URL addressability:** `/d/[id]` always resolves to an individual deployment scope. A "team URL" is just a flow URL that points to its entry deployment — there is no separate addressable "team" entity beyond the flow definition.

## Fractal framing

Jarble is a **fractal agent platform**. Every scale looks the same:

- A single deployment is addressable at `/d/[id]` — it has chat, a canvas, its own subagents, its own memory, its own capability set.
- A team (flow) is just a deployment-of-deployments — the entry bot is "the deployment you're talking to" and its teammates are its specialist toolbox, same way subagents are its internal toolbox.
- A team-of-teams is the next zoom-out. An entry bot can delegate to a specialist which is ITSELF the entry of another team, which in turn has its own specialists, and so on.

**The chat/canvas/URL pattern MUST be identical at every level.** When the user opens `/d/[entry-id]`, they're talking to either "just that bot" OR "that bot and everything it orchestrates" — they shouldn't have to learn a different UI depending on whether the deployment they opened happens to be an entry point of a team. Team Chat is not a separate mode; it's what `/d/[id]` looks like when the deployment has teammates.

**Run vs Team Chat in the fractal model:**
- Both are entry points into the same orchestration tree
- Run = "execute the pre-drawn plan with these prompts already baked into nodes" — for repeatable pipelines
- Team Chat (= `/d/[id]` chat when the deployment has teammates) = "tell me your goal and I'll figure out who to delegate to"
- Starter prompt for Run should slot into the entry node's args at execute time so both modes converge on "the entry bot receives a goal and decides what happens next"

**Why:** The founder framed this explicitly: "deployments are essentially individual deployments but can be connected to a bigger team... it's like a fractal design." Earlier also: "a fractal of agents... each deployment already has its own deployment page and chat and canvas if a user wanted to talk to them by itself."

**Teams are also distributed compute.** Each deployment is its own K8s pod on its own Hetzner worker. When you assemble deployments into a team, you're not just composing capabilities — you're composing **physical compute**. Parallel branches in the flow DAG run on literally different nodes in the cluster. This is why:
- Billing is per-deployment (per-pod) and rolls up at the team level; there's no shared team container
- Scale is horizontal by adding deployments to a team, not by vertically scaling a single bot
- The descaling bug was catastrophic precisely because killing one pod removed both a capability AND a compute unit from every team that referenced it
- Memory/state is per-pod by default; conversation-scoped memory is a cross-cutting concern, not a team-local one
- Real-time team visualizations should expose compute heat (which pod is working right now) in addition to the logical graph

**How to apply:**
- Never propose removing or degrading `/d/[id]` in favor of a team-only surface — that's the wrong direction
- Any orchestration feature added to a team should ALSO work when you drill into a sub-specialist at `/d/[specialist-id]` and treat IT as the root
- The Run button and Team Chat on a team should ultimately converge: both let the entry bot receive a goal and delegate
- Delegation tree visualizations must be recursive-aware — a specialist that is itself an entry must be drillable
- When scoping new team features, ask "does this pattern still hold if the user zoomed in to any sub-node?"
- Memory scoping, canvas attribution, and billing all need to be recursion-aware — not just "team vs individual"
- Compute/resource views should aggregate per-pod stats up through the team hierarchy, not hide that each node is its own K8s workload
