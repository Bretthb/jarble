import { router } from "./middleware.js";
import { userRouter } from "./routers/user.js";
import { deploymentRouter } from "./routers/deployment.js";
import { runtimeCatalogRouter } from "./routers/runtimeCatalog.js";
import { templateRouter } from "./routers/template.js";
import { openrouterRouter } from "./routers/openrouter.js";
import { platformCredentialsRouter } from "./routers/platformCredentials.js";
import { billingRouter } from "./routers/billing.js";
import { skillsRouter } from "./routers/skills.js";
import { marketplaceRouter } from "./routers/marketplace.js";
import { servicesRouter } from "./routers/services.js";
import { apiKeysRouter } from "./routers/apiKeys.js";
import { benchmarksRouter } from "./routers/benchmarks.js";
import { agentCreditsRouter } from "./routers/agentCredits.js";
import { adminRouter } from "./routers/admin.js";
import { flowsRouter } from "./routers/flows.js";
import { subagentsRouter } from "./routers/subagents.js";

export const appRouter = router({
  user: userRouter,
  deployment: deploymentRouter,
  runtimeCatalog: runtimeCatalogRouter,
  template: templateRouter,
  openrouter: openrouterRouter,
  platformCredentials: platformCredentialsRouter,
  billing: billingRouter,
  skills: skillsRouter,
  marketplace: marketplaceRouter,
  services: servicesRouter,
  apiKeys: apiKeysRouter,
  benchmarks: benchmarksRouter,
  agentCredits: agentCreditsRouter,
  admin: adminRouter,
  flows: flowsRouter,
  subagents: subagentsRouter,
});

// Export type for frontend
export type AppRouter = typeof appRouter;
