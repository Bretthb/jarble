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
 * Returns { valid, discountType, discountAmount, message? }
 */
promoRouter.post("/validate", async (req, res) => {
  try {
    const { code } = req.body;

    if (!code || typeof code !== "string" || code.trim().length === 0) {
      return res.json({ valid: false, message: "Promo code is required" });
    }

    const promo = await db.query.promoCodes.findFirst({
      where: and(
        eq(promoCodes.code, code.trim().toUpperCase()),
        eq(promoCodes.active, true),
      ),
    });

    if (!promo) {
      return res.json({ valid: false, message: "Invalid promo code" });
    }

    // Check expiration
    if (promo.expiresAt && new Date(promo.expiresAt) < new Date()) {
      return res.json({ valid: false, message: "This promo code has expired" });
    }

    // Check max uses
    if (promo.maxUses !== null && promo.currentUses >= promo.maxUses) {
      return res.json({ valid: false, message: "This promo code has reached its usage limit" });
    }

    logger.info({ code: promo.code, discountType: promo.discountType, discountAmount: promo.discountAmount }, "Promo code validated");

    return res.json({
      valid: true,
      discountType: promo.discountType,
      discountAmount: promo.discountAmount,
    });
  } catch (err) {
    logger.error({ err }, "Failed to validate promo code");
    return res.status(500).json({ valid: false, message: "Validation failed" });
  }
});
