---
name: feedback_deployments_page
description: User flagged /deployments page and orchestration UI as needing significant polish work
type: feedback
---

The /deployments page needs focused polish — it's the most complex view with 3 tabs and the orchestration system lives here.

**Why:** User explicitly called this out as "really needs some work" — it's a priority area for testing and fixing.

**How to apply:**
- Every overnight QA session should run flow builder (persona 10) and flow runner (persona 22) personas
- Focus on: graph rendering, flow canvas drag/connect/save/run, resource map connections, tab switching, performance, empty states
- The orchestration features (flows, execution, HITL pause/resume) need heavy real-world testing
- Check Deployments.tsx (1600+ lines) for visual bugs, layout issues, interaction problems
- Test with 0, 1, 5, and 10+ deployments to verify scaling
