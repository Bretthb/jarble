import { router } from "./middleware.js";
import { userRouter } from "./routers/user.js";
import { deploymentRouter } from "./routers/deployment.js";
import { tierRouter } from "./routers/tier.js";
import { templateRouter } from "./routers/template.js";
import { openrouterRouter } from "./routers/openrouter.js";

export const appRouter = router({
  user: userRouter,
  deployment: deploymentRouter,
  tier: tierRouter,
  template: templateRouter,
  openrouter: openrouterRouter,
});

// Export type for frontend
export type AppRouter = typeof appRouter;
