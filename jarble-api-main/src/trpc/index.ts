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
import { adminRouter } from "./routers/admin.js";

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
  admin: adminRouter,
});

// Export type for frontend
export type AppRouter = typeof appRouter;
