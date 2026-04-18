---
name: Jarble Platform Vision — Agent Mesh
description: Core product vision — agent mesh with distributed compute, marketplace for services/components, not just a bot deployment tool
type: project
---

Jarble is an **agent mesh platform**, not just a bot deployment tool. The bigger picture:

1. **Agent Mesh**: Pods are interconnected agents. One pod can call another pod's services, distributing compute across the network. This is the core differentiator.

2. **Marketplace = Distributed Compute**: The marketplace isn't just a component store — it's a service exchange where:
   - Users create services (hosted on their pods)
   - Other users' pods can consume those services
   - Compute is distributed across the mesh
   - Eventually users can **sell** their services and components

3. **UI Components Are a Key Feature**: The canvas/component system isn't a nice-to-have — it's central to the product. Users need to:
   - Create custom components easily
   - Edit components inline (sandbox, code blocks)
   - Publish components to the marketplace
   - Have other bots discover and use their components

4. **Full Lifecycle**: Deploy → Benchmark → Create Services → Publish to Marketplace → Monetize

5. **Agent Forking Flywheel** (future): Once users specialize and benchmark their agents, Jarble can fork top-performing user agents and run them as platform-hosted background services (using Jarble's own infrastructure). This creates a flywheel: more users building better agents → better platform quality for everyone. The platform improves organically as the community improves. Key implications:
   - Agents need benchmarking/scoring infrastructure
   - Need a "fork" mechanism (snapshot agent config, prompts, services, components)
   - Forked agents run on Jarble-hosted infra, not user pods
   - Licensing/attribution model for forked agents (revenue share?)
   - Quality bar / curation for which agents get forked

**Why:** This vision means every feature should be evaluated through the lens of: "Does this enable the agent mesh?" Not just "does the chat work?" but "can this bot's output become a service another bot consumes?" The forking flywheel means agent quality compounds over time — the platform's ceiling rises with its best users.

**How to apply:** When making architecture decisions, consider inter-pod communication, service discovery, compute distribution, and marketplace economics. The UI system should support both end-user interaction AND programmatic service consumption. Design agent configs to be portable/forkable — avoid hard-coupling agent state to a specific user or pod.
