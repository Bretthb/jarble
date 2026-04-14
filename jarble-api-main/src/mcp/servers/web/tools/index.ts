/**
 * Barrel of web-tool modules. Each module self-registers via `registerTool()`
 * at top level, so importing them for side effects is enough.
 *
 * The web server's `index.ts` imports this barrel to pull every tool into the
 * registry in a single statement.
 */

import "./search.js";
import "./reference.js";
import "./utility.js";
