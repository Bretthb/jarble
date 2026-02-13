import { router, publicProcedure } from "../middleware.js";

// Bot templates - could be moved to DB later
const TEMPLATES = [
  {
    id: "personal",
    name: "Personal Assistant",
    description: "A helpful personal assistant for everyday tasks",
    icon: "🤖",
    defaultModel: "anthropic/claude-sonnet-4",
  },
  {
    id: "business",
    name: "Business Helper",
    description: "Professional assistant for business communications",
    icon: "💼",
    defaultModel: "anthropic/claude-sonnet-4",
  },
  {
    id: "support",
    name: "Support Agent",
    description: "Customer support and help desk assistant",
    icon: "🎧",
    defaultModel: "anthropic/claude-sonnet-4",
  },
];

export const templateRouter = router({
  // List all templates
  list: publicProcedure.query(() => TEMPLATES),
});
