import { router } from "./middleware.js";
import { userRouter } from "./routers/user.js";
import { deploymentRouter } from "./routers/deployment.js";
import { runtimeCatalogRouter } from "./routers/runtimeCatalog.js";
import { templateRouter } from "./routers/template.js";
import { openrouterRouter } from "./routers/openrouter.js";

export const appRouter = router({
  user: userRouter,
  deployment: deploymentRouter,
  runtimeCatalog: runtimeCatalogRouter,
  template: templateRouter,
  openrouter: openrouterRouter,
});

// Export type for frontend
export type AppRouter = typeof appRouter;
