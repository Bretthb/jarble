# Jarble Frontend Debugger Memory

## Project Structure
- Frontend: `Jarble-mvp/` -- Next.js 15 App Router with `"use client"` views
- Views: `Jarble-mvp/views/` -- Dashboard, OnboardingWizard, DeploymentConfiguration, Billing, Settings, Analytics, Deployments
- Config tabs: `Jarble-mvp/views/deployment-config/` -- GeneralTab, ModelTab, PlatformsTab, SkillsTab, AdvancedTab, LogsTab
- Wizard config: `Jarble-mvp/views/onboarding/wizardStepConfig.ts` -- single source of truth for wizard steps, LLM providers, credit plans, hardware options
- SSE hooks: `Jarble-mvp/hooks/useStatusStream.ts`, `useLogStream.ts`, `useQrStream.ts`
- Auth: `Jarble-mvp/components/auth/Auth0Provider.tsx` (client-side Auth0, no middleware.ts)
- tRPC: `Jarble-mvp/lib/trpc.ts` + `Jarble-mvp/app/providers.tsx`

## Key Architecture Patterns
- All app pages are thin wrappers that import view components
- Auth is client-side only (no Next.js middleware) -- every view has its own auth guard
- SSE auth: token passed as query param (EventSource can't do custom headers)
- tRPC provider uses authRef pattern to avoid recreating client on auth state changes
- Mutations use `deploymentQuery.refetch()` pattern (not `utils.invalidate()`)

## Known Issues (from Feb 2026 audit)
- useStatusStream: No reconnection with fresh token on error
- Dashboard: isToggling/isExporting shared across all cards (not scoped by deployment ID)
- DeploymentConfiguration: No loading state for initial fetch; delete button not disabled during pending
- ModelTab IncludedKeySection: Uses window.location.reload() instead of query invalidation
- Billing handleManageBilling: No loading/error feedback
- AdvancedTab: Danger zone buttons are non-functional; webhook input not wired to state
- OnboardingWizard: deployProgress state is never updated
- useLogStream: isPaused is cosmetic only (does not pause data collection)
- Missing "use client" on ModelTab, AdvancedTab (works via parent but fragile)

## tRPC Router Structure (procedures seen in frontend)
- deployment: list, getById, create, deploy, update, delete, stop, start, restart, cancel, reactivate, exportConfigs, canDeploy, listLinkableDeployments, getStorageUsage
- runtimeCatalog: list
- openrouter: validateProviderKey, getKeyUsage, updateKeyLimit, revokeKey, provisionKey
- platformCredentials: getByDeployment, save, delete, testConnection, checkWhatsAppStatus
- billing: getOverview, getInvoices, getSubscriptions
- user: getProfile, updateProfile, resendVerificationEmail
