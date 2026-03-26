---
description: "Add a new messaging platform (e.g., LINE, WeChat) to the Jarble platform. Walks through all 5 required touchpoints."
---

Add a new messaging platform to Jarble. Ask the user which platform if not specified.

This requires changes in 5 files — follow each step exactly:

### Step 1: Platform Credentials
Read and edit `jarble-api-main/src/trpc/routers/platformCredentials.ts`:
- Add the platform's credential field names to `PLATFORM_CREDENTIAL_KEYS`
- Add the env var mapping to `PLATFORM_ENV_MAP`

### Step 2: Runtime Config
Read and edit `jarble-api-main/src/runtimes/handlers/openclaw.ts`:
- Add channel config block in `renderConfigs()` for the new platform
- Add secret entries in `getSecretEntries()` if the platform needs tokens as env vars

### Step 3: Wizard Step Config
Read and edit `Jarble-mvp/views/onboarding/wizardStepConfig.ts`:
- Add the platform step to `RUNTIME_EXTRA_STEPS` for relevant runtimes
- Add any platform-specific config fields

### Step 4: Wizard UI
Read and edit `Jarble-mvp/views/onboarding/OnboardingWizard.tsx`:
- Add the credential input form for the new platform
- Add the platform to `Jarble-mvp/views/deployments/DeploymentConfiguration.tsx` sidebar

### Step 5: Verify
Run both typechecks:
```bash
cd jarble-api-main && npx tsc --noEmit
cd Jarble-mvp && npx tsc --noEmit
```

Report all files modified and verification results.
