import type { RequestHandler } from "express";

/** Lightweight cache middleware for tRPC query responses */
export function trpcCacheMiddleware(): RequestHandler {
  // Cache these read-heavy queries (values in seconds)
  const CACHED_QUERIES: Record<string, number> = {
    "runtimeCatalog.list": 300,      // 5 min - rarely changes
    "template.list": 300,            // 5 min
    "marketplace.listPublished": 60, // 1 min
    "services.listPublished": 60,    // 1 min
    "deployment.list": 10,           // 10 sec - changes more often
    "flows.list": 10,                // 10 sec
  };

  return (req, res, next) => {
    // tRPC sends query path in the URL: /trpc/router.procedure
    // Only cache GET (batch) and individual query requests
    if (req.method === "GET") {
      const path = req.path.replace(/^\/trpc\//, "").replace(/^\//, "");
      const maxAge = CACHED_QUERIES[path];
      if (maxAge) {
        res.setHeader(
          "Cache-Control",
          `private, max-age=${maxAge}, stale-while-revalidate=${maxAge * 2}`
        );
      }
    }
    next();
  };
}
