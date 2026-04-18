---
name: Jarble is an AI workforce — use the human team analogy as a design compass
description: When a design question comes up, ask "what would a human team do here?" and the answer usually maps directly to the right implementation
type: feedback
---

Jarble's core mental model is a **workforce of AI people**. Each deployment = one person with their own brain (pod), memory (PVC), and skills (runtime + subagents). Teams = humans collaborating on projects. Everything composes fractally because human organizations do: person → team → department → company → industry.

**Why:** The founder said explicitly: "It's like normal humans right like each person has their own life and own things but they can collaborate together to distribute work and create something large." This isn't just a pitch — it's a design compass for resolving ambiguous decisions.

**Cost model is "bring your own compute" (important):** Team members must be agents the user is actively paying for. A team of size N = N paid deployments on that user's account. This is the whole business model — teams are assembled from your own payroll, not subsidized by Jarble. Paying more = bigger teams. Revenue scales linearly with team capability, which resolves the pod-per-deployment unit-economics concern (it's fully user-funded).

**No free tier.** Real users pay from day one via Stripe. The "free" access the founder uses during development is a Stripe bypass specifically for the internal team while building — NOT a consumer freemium tier. Do not design onboarding flows around "free trial pods" or "freemium to paid" conversion funnels — the funnel is "Stripe subscription → deploy agent → use it." Onboarding should assume the user has already committed to paying.

**Teams are single-user for now.** Current scope: users can only put their OWN paid deployments into a team. Cross-user team composition (hiring someone else's deployment to join your team) is NOT in scope yet — the "marketplace" as a surface where builders publish deployments that other users can rent/deploy into their own teams is a future feature, not near-term. Every team today = 1 user's personal payroll arranged into an orchestration graph. Do not design features assuming cross-user delegation, cross-user trust, inter-account billing, or publisher dashboards until explicitly reopened. Marketplace design will be revised later.

**Product implications of the cost model:**
- Team builder palette should only show agents the user owns; empty state CTA = "Deploy your first agent"
- Adding a team member should display the cumulative monthly cost ("team total: 3 × $13.99 = $41.97/mo")
- Flow references to agents the user doesn't own → block + redirect to marketplace / deploy flow
- Stop vs Delete vs Remove-from-team must be three distinct UI actions with clear distinctions
- Marketplace is "hire an agent" — browse, deploy your own copy, lands in your palette
- Cross-user delegation (A's bot calls B's bot) is out of scope until inter-account payment flow exists
- UI must clearly communicate WHY the palette is filtered — it's the business model, not a bug

**Direct mappings that should guide implementation:**
- **Private memory vs shared work products** → long-term profile + conversation history stay per-deployment (private thoughts); flow results pass through edges (shared work products teammates can see)
- **Subagents vs teammates** → subagents are "your own internal thoughts and habits" (in-pod); teammates are "other people" (cross-pod). Never collapse the distinction.
- **Team Chat vs Run** → both are "asking someone for help." There should be one front door, not two. Run + starter prompt = same flow as Team Chat.
- **Failure isolation** → a sick colleague ≠ a brain stroke. Teammate crash should route around; subagent crash degrades the parent deployment.
- **Delegation depth cap** → humans implicitly cap at ~3 hops because the telephone game erodes signal. `MAX_DELEGATION_DEPTH = 4` has a principled basis, not an arbitrary number.
- **Marketplace** → humans hire based on declared skills + references + interviews. Agents need declared capabilities (résumé), usage metrics (references), and trial runs (interviews). Concrete product spec.
- **Pod-per-deployment isolation** → humans don't share brains. Of course deployments don't share pods. This justifies the Hetzner-per-bot cost.

**Pitch (use this, not "fractal agent platform"):**
> "Build your AI workforce. Each agent is its own person — own memory, own skills, own chat. Use them alone, or team them up. Agents can work for other agents. Pay per person, scale by hiring."

**Where the analogy stops holding (be careful):**
- Cloning — humans can't be duplicated, pods can. Don't use human metaphor to decide on replica count; that's a compute decision.
- Fatigue/time — pods accumulate cost linearly, humans need sleep. A "24/7 team" has a bill attached.
- Trust — humans build it from shared history; agents have code + metrics. Marketplace needs quantitative trust signals from day one.
- Context limits — humans have fuzzy but unbounded memory, agents have precise but bounded context. Agents need more explicit context-passing than humans at the same task.
- Emotion/politics — humans have ego; agents don't. Don't model coordination problems that only exist because humans are human.

**How to apply:**
- When stuck on a design decision, ask "how would a human team handle this?" — the answer usually maps 1:1
- Use "workforce" language in product copy, not "fractal" or "multi-agent"
- Defend the pod-per-deployment cost via the "each person has their own life" framing
- Align memory scoping + delegation semantics + marketplace design with how humans actually collaborate
