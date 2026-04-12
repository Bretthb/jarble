# CI Hardening: Workflow Validation & Runtime Rollout Strategy

**Status**: Implemented
**Date**: 2026-04-07
**Scope**: GitHub Actions workflows under `.github/workflows/`

## Summary

Two hardening changes landed together as part of the Agent Teams rescue
follow-up:

1. **actionlint** — a new dedicated workflow validates every change to
   any GitHub Actions YAML file. Catches bad `if:` expressions, missing
   required inputs, wrong context references, and shell-script errors
   before they can break `main` CI.
2. **Runtime image rollout notification** — the `deploy-runtimes.yml`
   workflow now optionally annotates a cluster-side ConfigMap when new
   runtime images are published, giving ops a single source of truth
   for the latest available image without automatically restarting
   user agent pods.

## 1. actionlint

### What changed

New file: `.github/workflows/actionlint.yml`

Triggers on pull_request and push-to-main/develop when any file under
`.github/workflows/**` changes. Runs the community
[`raven-actions/actionlint@v2`](https://github.com/raven-actions/actionlint)
action, which wraps [`rhysd/actionlint`](https://github.com/rhysd/actionlint).
`fail-on-error: true` makes the job fail (and thus block merges) if
any workflow lints dirty.

### Why a dedicated workflow instead of extending `ci.yml`

`ci.yml` already has 7 jobs, most of which require heavy setup:

- `typecheck-api`, `test-api`: `npm ci` in `jarble-api-main`
- `typecheck-frontend`, `test-frontend`, `build-frontend`,
  `manifest-check`: pnpm install + Node 22 setup

A workflow-only PR (e.g. updating an `if:` expression in
`deploy-frontend.yml`) does not touch any application code. Running all
of `ci.yml` for such a PR wastes ~5 minutes of runner time per push.

actionlint, by contrast, is a single-binary linter that runs in
~10 seconds on a clean checkout. Keeping it as its own workflow means:

- **Fast feedback** — workflow authors see lint errors in 20s, not 5m.
- **Clean required-check configuration** — GitHub branch protection can
  require "actionlint" as a status check without coupling workflow
  validation to frontend/API dependency health.
- **Decoupled triggers** — actionlint runs on `.github/workflows/**`
  changes only, so non-workflow PRs don't trigger it.

The tradeoff is one extra workflow file to maintain, which is
negligible compared to the CI time savings.

### Required status checks

Once this workflow has run successfully at least once on `main`, add
`actionlint` to the list of required status checks in GitHub branch
protection (Settings → Branches → `main` → Required status checks).

Existing required checks (from `ci.yml`):

- `Typecheck — API`
- `Typecheck — Frontend`
- `Test — API`
- `Test — Frontend`
- `Build — Frontend`
- `Manifest Sync`

New required check:

- `actionlint`

## 2. Runtime image rollout strategy

### What changed

`deploy-runtimes.yml` now has 4 new steps appended to each matrix job
(build-openclaw and build-zeroclaw), after the existing `docker/build-push-action`:

1. `Check if KUBE_CONFIG is configured` — reads the `KUBE_CONFIG` repo
   secret into an output; subsequent steps gate on this.
2. `Configure kubectl` (conditional) — decodes the base64 kubeconfig
   into `~/.kube/config`. Runs only if the secret is set.
3. `Annotate runtime image tracker ConfigMap` (conditional) — creates
   (idempotent) a `runtime-image-tracker` ConfigMap in the `jarble`
   namespace and stamps it with annotations:
   - `jarble.ai/openclaw-image` (or `zeroclaw-image`): the image digest
   - `jarble.ai/openclaw-commit`: the commit SHA that produced the image
   - `jarble.ai/openclaw-updated-at`: ISO 8601 UTC timestamp
4. `Notice when KUBE_CONFIG not configured` — runs when the secret is
   unset. Emits a notice to `$GITHUB_STEP_SUMMARY` explaining why no
   cluster action was taken and how to enable it.

### Design decision: annotate, don't restart

The original task options were:

- (a) `kubectl rollout restart` on all deployments with the runtime label
- (b) Slack/Discord webhook notification instead
- (c) `kubectl annotate` on a sentinel resource

We chose **(c) annotate a sentinel ConfigMap**.

**Why not (a) automatic rollout**: each Jarble agent pod is a separate
K8s Deployment and may be mid-conversation. Automatically restarting
every user's pod on every runtime push would:

- Drop in-flight streaming SSE responses (user sees "connection lost")
- Kill in-flight tool calls (e.g. an MCP call that's committing to a DB)
- Wipe the OpenClaw session state stored in the pod (users lose
  conversation context if it hasn't yet synced to the PVC)

This is destructive and would effectively turn every runtime patch
into a platform-wide outage. Even a rolling restart with
`maxUnavailable: 1` would disrupt dozens of users serially on each push.

**Why not (b) webhook notify**: a Slack webhook is fine as a human
notification but doesn't give ops a programmatic source of truth. The
admin UI can read a ConfigMap via the existing K8s API; reading
historical Slack messages is awkward.

**Why (c) annotate**: the ConfigMap is a passive, cluster-native record
of "what is the latest available runtime image". Ops tooling (an admin
panel, a CLI script, or a scheduled rolling-update job) can read it to
decide when and how to roll individual agents — one at a time, during
off-hours, skipping pods with active sessions, etc. The admin
`forceRefresh` tRPC procedure (see `jarble-api-main/src/trpc/routers/admin.ts`)
can be extended to consult this ConfigMap for the target image digest.

### Optional opt-in: set `KUBE_CONFIG` secret

To enable the annotation behavior:

1. Generate a kubeconfig that has only `get/create/patch` permissions
   on ConfigMaps in the `jarble` namespace. A minimal Role:

   ```yaml
   apiVersion: rbac.authorization.k8s.io/v1
   kind: Role
   metadata:
     namespace: jarble
     name: runtime-image-tracker-writer
   rules:
     - apiGroups: [""]
       resources: ["configmaps"]
       verbs: ["get", "create", "patch", "update"]
       resourceNames: ["runtime-image-tracker"]
   ```

   (The `create` verb needs to be unscoped because `resourceNames`
   doesn't filter `create` requests. If that's a concern, drop `create`
   and pre-provision the ConfigMap manually.)

2. Base64-encode the kubeconfig: `base64 -w0 ~/.kube/config-tracker`.
3. Add it as a repo secret named `KUBE_CONFIG` in
   Settings → Secrets and variables → Actions.

**If the secret is not set**, the workflow still succeeds. The
"Notice when KUBE_CONFIG not configured" step emits a summary block
explaining the skip — no failure, no false alarm.

### Blast radius of this workflow

Even with `KUBE_CONFIG` set, the workflow can only:

- Create one ConfigMap (`runtime-image-tracker`) in the `jarble`
  namespace (idempotent)
- Patch annotations on that ConfigMap

It cannot:

- Touch any pod or deployment
- Read or write secrets (unless the provided kubeconfig gives it those
  rights, which it shouldn't per the Role above)
- Affect any other namespace

This is the minimum-permissions default. Even a compromised GitHub
Actions runner can't use this pipeline to restart or delete user agents.

## Validation

YAML validity was confirmed by parsing each file with `js-yaml`:

```
OK actionlint.yml       jobs: actionlint
OK deploy-runtimes.yml  jobs: changes, build-openclaw, build-zeroclaw
OK ci.yml               jobs: label, typecheck-api, test-api, ...
```

Step-ID and `if:` expression references were also cross-checked — every
`if: steps.X.outputs.Y` in `deploy-runtimes.yml` resolves to a step
with `id: X` in the same job.

Once actionlint itself runs on these files (on the first push), it
will confirm the semantic validity of the workflow beyond just YAML
parsing.

## Files created / modified

- `.github/workflows/actionlint.yml` (new)
- `.github/workflows/deploy-runtimes.yml` (extended with 8 new steps
  across 2 jobs)
- `docs/audits/ci-hardening.md` (this file)
- `docs/audits/monitoring-stuck-deployments.md` (companion, for
  observability follow-up)

No application code was modified.
