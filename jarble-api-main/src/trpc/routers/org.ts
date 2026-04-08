import { z } from "zod";
import crypto from "crypto";
import { TRPCError } from "@trpc/server";
import { eq, and, inArray } from "drizzle-orm";
import { protectedProcedure, router } from "../middleware.js";
import { createModuleLogger } from "../../utils/logger.js";
import { customAlphabet } from "nanoid";
import { sendOrgInviteEmail } from "../../services/email.js";
import { env } from "../../utils/env.js";
import { noHtmlTags, NO_HTML_MESSAGE } from "../../utils/sanitize.js";

const log = createModuleLogger("trpc:org");
const nanoid = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 12);
const generateOrgId = () => `org_${nanoid()}`;
const generateMemberId = () => `mem_${nanoid()}`;
const generateInviteId = () => `inv_${nanoid()}`;
const generateInviteToken = () => crypto.randomBytes(32).toString("hex");

// ── Role helpers ───────────────────────────────────────────────────────────

type OrgRole = "owner" | "admin" | "member";

async function requireOrgMembership(
  db: any,
  userId: string,
  orgId: string,
): Promise<{ orgId: string; userId: string; role: OrgRole }> {
  const schema = await import("../../db/schema.pg.js");
  const membership = await db.query.orgMembers.findFirst({
    where: and(
      eq(schema.orgMembers.orgId, orgId),
      eq(schema.orgMembers.userId, userId),
    ),
  });
  if (!membership) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Not a member of this organization" });
  }
  return { orgId: membership.orgId, userId: membership.userId, role: membership.role as OrgRole };
}

async function requireOrgRole(
  db: any,
  userId: string,
  orgId: string,
  allowedRoles: OrgRole[],
): Promise<{ orgId: string; userId: string; role: OrgRole }> {
  const membership = await requireOrgMembership(db, userId, orgId);
  if (!allowedRoles.includes(membership.role)) {
    throw new TRPCError({ code: "FORBIDDEN", message: `Requires ${allowedRoles.join(" or ")} role` });
  }
  return membership;
}

// ── Router ─────────────────────────────────────────────────────────────────

export const orgRouter = router({
  // Create a new organization (caller becomes owner)
  create: protectedProcedure
    .input(z.object({
      name: z.string().min(1).max(100).refine(noHtmlTags, NO_HTML_MESSAGE),
      slug: z.string().min(2).max(50).regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, "Slug must be lowercase alphanumeric with hyphens"),
    }))
    .mutation(async ({ ctx, input }) => {
      const schema = await import("../../db/schema.pg.js");
      const { tables, dbDate } = await import("../../db/index.js");
      // Enforce max 10 orgs per user (only orgs they own)
      const ownedOrgs = await ctx.db.query.organizations.findMany({
        where: eq(schema.organizations.ownerId, ctx.user.id),
        columns: { id: true },
      });

      if (ownedOrgs.length >= 10) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You've reached the maximum of 10 organizations. Delete an unused org to create a new one.",
        });
      }

      // Check slug uniqueness
      const existing = await ctx.db.query.organizations.findFirst({
        where: eq(schema.organizations.slug, input.slug),
      });
      if (existing) {
        throw new TRPCError({ code: "CONFLICT", message: "This slug is already taken" });
      }

      const orgId = generateOrgId();
      const memberId = generateMemberId();
      const now = dbDate();

      // Create org
      await ctx.db.insert(tables.organizations).values({
        id: orgId,
        name: input.name,
        slug: input.slug,
        ownerId: ctx.user.id,
        createdAt: now,
        updatedAt: now,
      });

      // Add creator as owner member
      await ctx.db.insert(tables.orgMembers).values({
        id: memberId,
        orgId,
        userId: ctx.user.id,
        role: "owner",
        joinedAt: now,
      });

      log.info({ orgId, slug: input.slug, userId: ctx.user.id }, "Organization created");

      return { id: orgId, name: input.name, slug: input.slug };
    }),

  // List organizations the current user belongs to
  list: protectedProcedure.query(async ({ ctx }) => {
    const schema = await import("../../db/schema.pg.js");
    const memberships = await ctx.db.query.orgMembers.findMany({
      where: eq(schema.orgMembers.userId, ctx.user.id),
      with: { org: true },
    });

    return memberships.map((m: any) => ({
      id: m.org.id,
      name: m.org.name,
      slug: m.org.slug,
      avatarUrl: m.org.avatarUrl,
      role: m.role as OrgRole,
      joinedAt: m.joinedAt,
    }));
  }),

  // Get org details + members (requires membership)
  getById: protectedProcedure
    .input(z.object({ orgId: z.string() }))
    .query(async ({ ctx, input }) => {
      await requireOrgMembership(ctx.db, ctx.user.id, input.orgId);

      const schema = await import("../../db/schema.pg.js");
      const org = await ctx.db.query.organizations.findFirst({
        where: eq(schema.organizations.id, input.orgId),
        with: {
          members: { with: { user: { columns: { id: true, name: true, email: true } } } },
          owner: { columns: { id: true, name: true, email: true } },
        },
      });

      if (!org) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Organization not found" });
      }

      return {
        id: org.id,
        name: org.name,
        slug: org.slug,
        avatarUrl: org.avatarUrl,
        ownerId: org.ownerId,
        owner: org.owner,
        createdAt: org.createdAt,
        members: (org.members as any[]).map((m) => ({
          id: m.id,
          userId: m.userId,
          name: m.user?.name,
          email: m.user?.email,
          role: m.role,
          joinedAt: m.joinedAt,
        })),
      };
    }),

  // Update org info (owner or admin)
  update: protectedProcedure
    .input(z.object({
      orgId: z.string(),
      name: z.string().min(1).max(100).refine(noHtmlTags, NO_HTML_MESSAGE).optional(),
      avatarUrl: z.string().url().nullish(),
    }))
    .mutation(async ({ ctx, input }) => {
      await requireOrgRole(ctx.db, ctx.user.id, input.orgId, ["owner", "admin"]);

      const { tables, dbDate } = await import("../../db/index.js");
      const schema = await import("../../db/schema.pg.js");

      const updates: Record<string, any> = { updatedAt: dbDate() };
      if (input.name !== undefined) updates.name = input.name;
      if (input.avatarUrl !== undefined) updates.avatarUrl = input.avatarUrl ?? null;

      await ctx.db.update(tables.organizations).set(updates).where(eq(schema.organizations.id, input.orgId));

      log.info({ orgId: input.orgId, userId: ctx.user.id }, "Organization updated");
      return { success: true };
    }),

  // Delete org (owner only) -- unsets orgId on deployments, cascade deletes members/invites
  delete: protectedProcedure
    .input(z.object({ orgId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await requireOrgRole(ctx.db, ctx.user.id, input.orgId, ["owner"]);

      const { tables } = await import("../../db/index.js");
      const schema = await import("../../db/schema.pg.js");

      // Unset orgId on all org deployments (return them to personal mode)
      await ctx.db.update(tables.deployments).set({ orgId: null }).where(eq(schema.deployments.orgId, input.orgId));

      // Delete org (cascade handles members + invites)
      await ctx.db.delete(tables.organizations).where(eq(schema.organizations.id, input.orgId));

      log.info({ orgId: input.orgId, userId: ctx.user.id }, "Organization deleted");
      return { success: true };
    }),

  // ── Invites ──────────────────────────────────────────────────────────────

  // Send an invite (owner or admin)
  invite: protectedProcedure
    .input(z.object({
      orgId: z.string(),
      email: z.string().email(),
      role: z.enum(["admin", "member"]).default("member"),
    }))
    .mutation(async ({ ctx, input }) => {
      await requireOrgRole(ctx.db, ctx.user.id, input.orgId, ["owner", "admin"]);

      const { tables, dbDate } = await import("../../db/index.js");
      const schema = await import("../../db/schema.pg.js");

      // Check if already a member
      const existingMember = await ctx.db.query.orgMembers.findFirst({
        where: and(eq(schema.orgMembers.orgId, input.orgId), eq(schema.orgMembers.userId, input.email)),
      });
      // Note: we check by email, not userId -- the user may not exist yet

      // Check if invite already pending
      const existingInvite = await ctx.db.query.orgInvites.findFirst({
        where: and(
          eq(schema.orgInvites.orgId, input.orgId),
          eq(schema.orgInvites.email, input.email),
          eq(schema.orgInvites.status, "pending"),
        ),
      });
      if (existingInvite) {
        throw new TRPCError({ code: "CONFLICT", message: "An invite is already pending for this email" });
      }

      const inviteId = generateInviteId();
      const token = generateInviteToken();
      const now = dbDate();
      const expiresAt = dbDate(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)); // 7 days

      await ctx.db.insert(tables.orgInvites).values({
        id: inviteId,
        orgId: input.orgId,
        email: input.email,
        role: input.role,
        token,
        invitedBy: ctx.user.id,
        status: "pending",
        expiresAt,
        createdAt: now,
      });

      // Get org name for the email
      const org = await ctx.db.query.organizations.findFirst({
        where: eq(schema.organizations.id, input.orgId),
        columns: { name: true },
      });

      // Send invite email
      const inviteUrl = `${env.FRONTEND_URL}/invite/${token}`;
      await sendOrgInviteEmail(input.email, ctx.user.name || ctx.user.email, org?.name || "an organization", inviteUrl);

      log.info({ orgId: input.orgId, email: input.email, inviteId }, "Org invite sent");
      return { inviteId, token };
    }),

  // Accept an invite via token
  acceptInvite: protectedProcedure
    .input(z.object({ token: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { tables, dbDate } = await import("../../db/index.js");
      const schema = await import("../../db/schema.pg.js");

      const invite = await ctx.db.query.orgInvites.findFirst({
        where: eq(schema.orgInvites.token, input.token),
      });

      if (!invite) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Invite not found" });
      }
      if (invite.status !== "pending") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "This invite has already been used" });
      }

      // Check expiry
      const expiresAt = typeof invite.expiresAt === "string" ? new Date(invite.expiresAt) : invite.expiresAt;
      if (expiresAt < new Date()) {
        await ctx.db.update(tables.orgInvites).set({ status: "expired" }).where(eq(schema.orgInvites.id, invite.id));
        throw new TRPCError({ code: "BAD_REQUEST", message: "This invite has expired" });
      }

      // Verify email matches
      if (invite.email.toLowerCase() !== ctx.user.email.toLowerCase()) {
        throw new TRPCError({ code: "FORBIDDEN", message: "This invite was sent to a different email address" });
      }

      // Check if already a member
      const existingMember = await ctx.db.query.orgMembers.findFirst({
        where: and(
          eq(schema.orgMembers.orgId, invite.orgId),
          eq(schema.orgMembers.userId, ctx.user.id),
        ),
      });
      if (existingMember) {
        await ctx.db.update(tables.orgInvites).set({ status: "accepted" }).where(eq(schema.orgInvites.id, invite.id));
        return { orgId: invite.orgId, alreadyMember: true };
      }

      const memberId = generateMemberId();
      const now = dbDate();

      // Create membership
      await ctx.db.insert(tables.orgMembers).values({
        id: memberId,
        orgId: invite.orgId,
        userId: ctx.user.id,
        role: invite.role,
        invitedBy: invite.invitedBy,
        joinedAt: now,
      });

      // Mark invite as accepted
      await ctx.db.update(tables.orgInvites).set({ status: "accepted" }).where(eq(schema.orgInvites.id, invite.id));

      log.info({ orgId: invite.orgId, userId: ctx.user.id, inviteId: invite.id }, "Org invite accepted");
      return { orgId: invite.orgId, alreadyMember: false };
    }),

  // List pending invites for an org (owner or admin)
  listInvites: protectedProcedure
    .input(z.object({ orgId: z.string() }))
    .query(async ({ ctx, input }) => {
      await requireOrgRole(ctx.db, ctx.user.id, input.orgId, ["owner", "admin"]);

      const schema = await import("../../db/schema.pg.js");
      const invites = await ctx.db.query.orgInvites.findMany({
        where: and(
          eq(schema.orgInvites.orgId, input.orgId),
          eq(schema.orgInvites.status, "pending"),
        ),
        with: {
          invitedByUser: { columns: { id: true, name: true, email: true } },
        },
      });

      return invites.map((inv: any) => ({
        id: inv.id,
        email: inv.email,
        role: inv.role,
        invitedBy: inv.invitedByUser,
        expiresAt: inv.expiresAt,
        createdAt: inv.createdAt,
      }));
    }),

  // Cancel a pending invite (owner or admin)
  cancelInvite: protectedProcedure
    .input(z.object({ inviteId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { tables } = await import("../../db/index.js");
      const schema = await import("../../db/schema.pg.js");

      const invite = await ctx.db.query.orgInvites.findFirst({
        where: eq(schema.orgInvites.id, input.inviteId),
      });
      if (!invite) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Invite not found" });
      }

      await requireOrgRole(ctx.db, ctx.user.id, invite.orgId, ["owner", "admin"]);

      await ctx.db.delete(tables.orgInvites).where(eq(schema.orgInvites.id, input.inviteId));

      log.info({ inviteId: input.inviteId, orgId: invite.orgId }, "Org invite cancelled");
      return { success: true };
    }),

  // ── Member management ────────────────────────────────────────────────────

  // Remove a member from the org
  removeMember: protectedProcedure
    .input(z.object({ orgId: z.string(), userId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const callerMembership = await requireOrgRole(ctx.db, ctx.user.id, input.orgId, ["owner", "admin"]);

      // Can't remove yourself (use leave instead)
      if (input.userId === ctx.user.id) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Use the leave action to remove yourself" });
      }

      const { tables } = await import("../../db/index.js");
      const schema = await import("../../db/schema.pg.js");

      // Check target membership
      const targetMembership = await requireOrgMembership(ctx.db, input.userId, input.orgId);

      // Admin can only remove members, not other admins or owner
      if (callerMembership.role === "admin" && targetMembership.role !== "member") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Admins can only remove members" });
      }

      // Owner can't be removed
      if (targetMembership.role === "owner") {
        throw new TRPCError({ code: "FORBIDDEN", message: "The owner cannot be removed" });
      }

      // Unset orgId on member's deployments in this org
      await ctx.db.update(tables.deployments).set({ orgId: null }).where(
        and(eq(schema.deployments.orgId, input.orgId), eq(schema.deployments.userId, input.userId)),
      );

      // Remove membership
      await ctx.db.delete(tables.orgMembers).where(
        and(eq(schema.orgMembers.orgId, input.orgId), eq(schema.orgMembers.userId, input.userId)),
      );

      log.info({ orgId: input.orgId, removedUserId: input.userId, by: ctx.user.id }, "Member removed from org");
      return { success: true };
    }),

  // Update a member's role (owner only)
  updateMemberRole: protectedProcedure
    .input(z.object({
      orgId: z.string(),
      userId: z.string(),
      role: z.enum(["admin", "member"]),
    }))
    .mutation(async ({ ctx, input }) => {
      await requireOrgRole(ctx.db, ctx.user.id, input.orgId, ["owner"]);

      if (input.userId === ctx.user.id) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot change your own role" });
      }

      const { tables } = await import("../../db/index.js");
      const schema = await import("../../db/schema.pg.js");

      // Verify target is a member
      await requireOrgMembership(ctx.db, input.userId, input.orgId);

      await ctx.db.update(tables.orgMembers).set({ role: input.role }).where(
        and(eq(schema.orgMembers.orgId, input.orgId), eq(schema.orgMembers.userId, input.userId)),
      );

      log.info({ orgId: input.orgId, userId: input.userId, newRole: input.role }, "Member role updated");
      return { success: true };
    }),

  // Leave an org (any member except owner)
  leave: protectedProcedure
    .input(z.object({ orgId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const membership = await requireOrgMembership(ctx.db, ctx.user.id, input.orgId);

      if (membership.role === "owner") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "The owner cannot leave. Transfer ownership or delete the organization." });
      }

      const { tables } = await import("../../db/index.js");
      const schema = await import("../../db/schema.pg.js");

      // Unset orgId on user's deployments in this org
      await ctx.db.update(tables.deployments).set({ orgId: null }).where(
        and(eq(schema.deployments.orgId, input.orgId), eq(schema.deployments.userId, ctx.user.id)),
      );

      // Remove membership
      await ctx.db.delete(tables.orgMembers).where(
        and(eq(schema.orgMembers.orgId, input.orgId), eq(schema.orgMembers.userId, ctx.user.id)),
      );

      log.info({ orgId: input.orgId, userId: ctx.user.id }, "User left org");
      return { success: true };
    }),
});
