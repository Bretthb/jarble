/**
 * Test database helper - creates a fresh in-memory SQLite DB per test suite.
 *
 * Uses better-sqlite3 (devDependency only) + drizzle-orm to mirror the Postgres
 * production schema. Drizzle abstracts the SQL differences so tests exercise
 * real query logic without requiring a running Postgres server.
 */
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as sqliteSchema from "./testSchema.sqlite.js";

// Mirrors the full schema from db/init.ts — kept in sync with schema.pg.ts columns.
// This is SQLite DDL used ONLY for tests; production uses Postgres.
const CREATE_TABLES_SQL = `
  CREATE TABLE IF NOT EXISTS runtime_catalog (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT,
    category TEXT DEFAULT 'bot' NOT NULL,
    docker_image TEXT NOT NULL,
    cpu_limit TEXT DEFAULT '2.0' NOT NULL,
    memory_mb INTEGER DEFAULT 2048 NOT NULL,
    storage_mb INTEGER DEFAULT 30 NOT NULL,
    monthly_price_cents INTEGER DEFAULT 0 NOT NULL,
    is_active INTEGER DEFAULT 1 NOT NULL,
    created_at TEXT DEFAULT (datetime('now')) NOT NULL
  );

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT,
    auth0_id TEXT NOT NULL UNIQUE,
    email_verified INTEGER DEFAULT 0 NOT NULL,
    role TEXT DEFAULT 'user' NOT NULL,
    stripe_customer_id TEXT,
    pending_stripe_subscription_id TEXT,
    free_deployment_used INTEGER DEFAULT 0 NOT NULL,
    free_trial_expires_at TEXT,
    created_at TEXT DEFAULT (datetime('now')) NOT NULL,
    updated_at TEXT DEFAULT (datetime('now')) NOT NULL
  );
