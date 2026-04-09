import { Router } from "express";
import { db } from "../db/index.js";
import { promoCodes } from "../db/schema.pg.js";
import { eq, and } from "drizzle-orm";
import { createModuleLogger } from "../utils/logger.js";

const logger = createModuleLogger("promo");

export const promoRouter = Router();

/**
 * POST /api/promo/validate
 * Validate a promo code. Public endpoint (no auth required).
 */
promoRouter.post("/validate", async (req, res) => {
  try {
    const { code } = req.body;

    if (!code || typeof code !== "string" || code.trim().length === 0) {
      res.json({ valid: false, message: "Promo code is required" });
      return;
    }

    const promo = await db.query.promoCodes.findFirst({
      where: and(
        eq(promoCodes.code, code.trim().toUpperCase()),
        eq(promoCodes.active, true),
      ),
    });

    if (!promo) {
      res.json({ valid: false, message: "Invalid promo code" });
      return;
    }

    if (promo.expiresAt && new Date(promo.expiresAt) < new Date()) {
      res.json({ valid: false, message: "This promo code has expired" });
      return;
    }

    if (promo.maxUses !== null && promo.currentUses >= promo.maxUses) {
      res.json({ valid: false, message: "This promo code has reached its usage limit" });
      return;
    }

    logger.info({ code: promo.code, discountType: promo.discountType, discountAmount: promo.discountAmount }, "Promo code validated");

    res.json({
      valid: true,
      discountType: promo.discountType,
      discountAmount: promo.discountAmount,
    });
  } catch (err) {
    logger.error({ err }, "Failed to validate promo code");
    res.status(500).json({ valid: false, message: "Validation failed" });
  }
});
