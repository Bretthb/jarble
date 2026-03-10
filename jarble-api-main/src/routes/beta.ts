/**
 * Beta Signup Route — Public endpoint for beta tester applications.
 * No auth required. Stores signups in the beta_signups table for manual review.
 */
import { Router } from "express";
import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import { db, tables, dbDate } from "../db/index.js";
import { logger } from "../utils/logger.js";

export const betaRouter = Router();

betaRouter.post("/", async (req, res) => {
  try {
    const { name, email, useCase, experience } = req.body;

    if (!name?.trim() || !email?.trim()) {
      res.status(400).json({ error: "Name and email are required" });
      return;
    }

    // Basic email format check
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      res.status(400).json({ error: "Invalid email address" });
      return;
    }

    const id = nanoid();
    await db.insert(tables.betaSignups).values({
      id,
      name: name.trim(),
      email: email.trim().toLowerCase(),
      experience: experience || null,
      useCase: useCase?.trim() || null,
      createdAt: dbDate(),
    } as any);

    logger.info({ id, email: email.trim().toLowerCase() }, "Beta signup received");
    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "Failed to save beta signup");
    res.status(500).json({ error: "Failed to submit application" });
  }
});
