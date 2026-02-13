import { mysqlTable, varchar, text, int, timestamp, boolean, decimal } from "drizzle-orm/mysql-core";
import { relations } from "drizzle-orm";

export const users = mysqlTable("users", {
  id: varchar("id", { length: 255 }).primaryKey(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  name: varchar("name", { length: 255 }),
  auth0Id: varchar("auth0_id", { length: 255 }).notNull().unique(),
  stripeCustomerId: varchar("stripe_customer_id", { length: 255 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});

export const bots = mysqlTable("bots", {
  id: varchar("id", { length: 255 }).primaryKey(),
  userId: varchar("user_id", { length: 255 }).notNull().references(() => users.id),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  template: varchar("template", { length: 100 }),
  status: varchar("status", { length: 50 }).notNull().default("creating"),
  error: text("error"),
  tierId: int("tier_id").references(() => tiers.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});

export const tiers = mysqlTable("tiers", {
  id: int("id").primaryKey().autoincrement(),
  name: varchar("name", { length: 100 }).notNull(),
  description: text("description"),
  price: decimal("price", { precision: 10, scale: 2 }).notNull(),
  creditsPerMonth: int("credits_per_month").notNull(),
  features: text("features"), // JSON string
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Relations
export const usersRelations = relations(users, ({ many }) => ({
  bots: many(bots),
}));

export const botsRelations = relations(bots, ({ one }) => ({
  user: one(users, { fields: [bots.userId], references: [users.id] }),
  tier: one(tiers, { fields: [bots.tierId], references: [tiers.id] }),
}));
