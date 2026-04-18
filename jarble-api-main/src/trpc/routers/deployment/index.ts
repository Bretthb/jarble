import { router } from "../../middleware.js";
import { procedures1 } from "./procedures1.js";
import { procedures2 } from "./procedures2.js";

export const deploymentRouter = router({
  ...procedures1,
  ...procedures2,
});
