import { pgTable, varchar, text, integer, timestamp, boolean, numeric, serial } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

export const users = pgTable("users", {
  id: varchar("id", { length: 255 }).primaryKey(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  name: varchar("name", { length: 255 }),
  auth0Id: varchar("auth0_id", { length: 255 }).notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  stripeCustomerId: varchar("stripe_customer_id", { length: 255 }),
  tierId: integer("tier_id").references(() => tiers.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const deployments = pgTable("deployments", {
  id: varchar("id", { length: 255 }).primaryKey(),
  userId: varchar("user_id", { length: 255 }).notNull().references(() => users.id),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  template: varchar("template", { length: 100 }),
  runtime: varchar("runtime", { length: 100 }).notNull().default("openclaw"),
  image: varchar("image", { length: 255 }),
  status: varchar("status", { length: 50 }).notNull().default("creating"),
  error: text("error"),
  tierId: integer("tier_id").references(() => tiers.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const tiers = pgTable("tiers", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  description: text("description"),
  price: numeric("price", { precision: 10, scale: 2 }).notNull(),
  creditsPerMonth: integer("credits_per_month").notNull(),
  maxDeployments: integer("max_deployments").notNull().default(1),
  features: text("features"), // JSON string
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
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
