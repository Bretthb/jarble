import { router } from "./middleware.js";
import { userRouter } from "./routers/user.js";
import { deploymentRouter } from "./routers/deployment.js";
import { runtimeCatalogRouter } from "./routers/runtimeCatalog.js";
import { openrouterRouter } from "./routers/openrouter.js";
import { platformCredentialsRouter } from "./routers/platformCredentials.js";
import { deploymentSecretsRouter } from "./routers/deploymentSecrets.js";
import { billingRouter } from "./routers/billing.js";
import { skillsRouter } from "./routers/skills.js";
import { apiKeysRouter } from "./routers/apiKeys.js";
import { adminRouter } from "./routers/admin.js";
import { flowsRouter } from "./routers/flows.js";
import { subagentsRouter } from "./routers/subagents.js";
import { orgRouter } from "./routers/org.js";

export const appRouter = router({
  user: userRouter,
  deployment: deploymentRouter,
  runtimeCatalog: runtimeCatalogRouter,
  openrouter: openrouterRouter,
  platformCredentials: platformCredentialsRouter,
  deploymentSecrets: deploymentSecretsRouter,
  billing: billingRouter,
  skills: skillsRouter,
  apiKeys: apiKeysRouter,
  admin: adminRouter,
  flows: flowsRouter,
  subagents: subagentsRouter,
  org: orgRouter,
});

// Export type for frontend
export type AppRouter = typeof appRouter;
