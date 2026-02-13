import { drizzle } from "drizzle-orm/mysql2";
import { tiers, modelProviders, platforms } from "./drizzle/schema.js";

const db = drizzle(process.env.DATABASE_URL);

async function seed() {
  console.log("🌱 Seeding database...");

  try {
    // Seed tiers
    await db.insert(tiers).values([
      {
        name: "bronze",
        displayName: "Bronze",
        description: "Perfect for getting started",
        maxConnections: 1,
        maxSkills: 5,
        monthlyRequests: 10000,
        price: 900, // $9.00
        badge: "🥉",
      },
      {
        name: "silver",
        displayName: "Silver",
        description: "For growing projects",
        maxConnections: 3,
        maxSkills: 15,
        monthlyRequests: 50000,
        price: 2900, // $29.00
        badge: "🥈",
      },
      {
        name: "gold",
        displayName: "Gold",
        description: "For professional use",
        maxConnections: 5,
        maxSkills: 30,
        monthlyRequests: 200000,
        price: 7900, // $79.00
        badge: "🥇",
      },
      {
        name: "platinum",
        displayName: "Platinum",
        description: "Unlimited everything",
        maxConnections: 999,
        maxSkills: 999,
        monthlyRequests: 999999999,
        price: 19900, // $199.00
        badge: "💎",
      },
    ]);

    console.log("✓ Tiers seeded");

    // Seed model providers
    await db.insert(modelProviders).values([
      {
        name: "openai",
        displayName: "OpenAI",
        description: "GPT-4, GPT-3.5, and more",
        icon: "🤖",
        requiresApiKey: true,
        apiKeyLabel: "OpenAI API Key",
      },
      {
        name: "anthropic",
        displayName: "Anthropic",
        description: "Claude AI models",
        icon: "🧠",
        requiresApiKey: true,
        apiKeyLabel: "Anthropic API Key",
      },
      {
        name: "google",
        displayName: "Google",
        description: "Gemini and PaLM models",
        icon: "🔍",
        requiresApiKey: true,
        apiKeyLabel: "Google API Key",
      },
      {
        name: "cohere",
        displayName: "Cohere",
        description: "Cohere language models",
        icon: "🎯",
        requiresApiKey: true,
        apiKeyLabel: "Cohere API Key",
      },
    ]);

    console.log("✓ Model providers seeded");

    // Seed platforms
    await db.insert(platforms).values([
      {
        name: "discord",
        displayName: "Discord",
        description: "Connect to Discord servers",
        icon: "💬",
        requiresConfig: true,
      },
      {
        name: "slack",
        displayName: "Slack",
        description: "Integrate with Slack workspaces",
        icon: "📱",
        requiresConfig: true,
      },
      {
        name: "telegram",
        displayName: "Telegram",
        description: "Deploy on Telegram",
        icon: "✈️",
        requiresConfig: true,
      },
      {
        name: "whatsapp",
        displayName: "WhatsApp",
        description: "Connect via WhatsApp Business API",
        icon: "💚",
        requiresConfig: true,
      },
      {
        name: "web",
        displayName: "Web",
        description: "Embed on your website",
        icon: "🌐",
        requiresConfig: false,
      },
    ]);

    console.log("✓ Platforms seeded");

    console.log("✅ Database seeded successfully!");
    process.exit(0);
  } catch (error) {
    console.error("❌ Seeding failed:", error);
    process.exit(1);
  }
}

seed();
