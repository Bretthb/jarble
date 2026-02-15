import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { relations } from "drizzle-orm";

const now = () => new Date().toISOString();

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name"),
  auth0Id: text("auth0_id").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
  stripeCustomerId: text("stripe_customer_id"),
  tierId: integer("tier_id").references(() => tiers.id),
  createdAt: text("created_at").notNull().$defaultFn(now),
  updatedAt: text("updated_at").notNull().$defaultFn(now),
});

export const deployments = sqliteTable("deployments", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  name: text("name").notNull(),
  description: text("description"),
  template: text("template"),
  runtime: text("runtime").notNull().default("openclaw"),
  image: text("image"),
  status: text("status").notNull().default("creating"),
  error: text("error"),
  tierId: integer("tier_id").references(() => tiers.id),
  createdAt: text("created_at").notNull().$defaultFn(now),
  updatedAt: text("updated_at").notNull().$defaultFn(now),
});

export const tiers = sqliteTable("tiers", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  description: text("description"),
  price: text("price").notNull(),
  creditsPerMonth: integer("credits_per_month").notNull(),
  maxDeployments: integer("max_deployments").notNull().default(1),
  features: text("features"),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull().$defaultFn(now),
});

// Relations
export const usersRelations = relations(users, ({ many, one }) => ({
  deployments: many(deployments),
  tier: one(tiers, { fields: [users.tierId], references: [tiers.id] }),
}));

export const deploymentsRelations = relations(deployments, ({ one }) => ({
  user: one(users, { fields: [deployments.userId], references: [users.id] }),
  tier: one(tiers, { fields: [deployments.tierId], references: [tiers.id] }),
}));
