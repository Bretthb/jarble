import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * We need to test the module's init behavior which reads process.env at import
 * time, so we re-import the module in each test after setting the env var.
 */

describe("admin utility", () => {
  const originalEnv = process.env.ADMIN_USER_IDS;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    // Restore original env
    if (originalEnv === undefined) {
      delete process.env.ADMIN_USER_IDS;
    } else {
      process.env.ADMIN_USER_IDS = originalEnv;
    }
  });

  it("parses comma-separated user IDs", async () => {
    process.env.ADMIN_USER_IDS = "auth0|abc123,auth0|def456";
    const { isAdmin, getAdminUserIds } = await import("./admin.js");

    expect(getAdminUserIds().size).toBe(2);
    expect(isAdmin("auth0|abc123")).toBe(true);
    expect(isAdmin("auth0|def456")).toBe(true);
    expect(isAdmin("auth0|unknown")).toBe(false);
  });

  it("trims whitespace around IDs", async () => {
    process.env.ADMIN_USER_IDS = "  user1 , user2 ,  user3  ";
    const { isAdmin, getAdminUserIds } = await import("./admin.js");

    expect(getAdminUserIds().size).toBe(3);
    expect(isAdmin("user1")).toBe(true);
    expect(isAdmin("user2")).toBe(true);
    expect(isAdmin("user3")).toBe(true);
  });

  it("handles a single user ID", async () => {
    process.env.ADMIN_USER_IDS = "solo-admin";
    const { isAdmin, getAdminUserIds } = await import("./admin.js");

    expect(getAdminUserIds().size).toBe(1);
    expect(isAdmin("solo-admin")).toBe(true);
  });

  it("returns empty set and logs warning when env var is unset", async () => {
    delete process.env.ADMIN_USER_IDS;
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { isAdmin, getAdminUserIds } = await import("./admin.js");

    expect(getAdminUserIds().size).toBe(0);
    expect(isAdmin("anyone")).toBe(false);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("ADMIN_USER_IDS env var is empty or unset")
    );

    warnSpy.mockRestore();
  });

  it("returns empty set and logs warning when env var is empty string", async () => {
    process.env.ADMIN_USER_IDS = "";
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { isAdmin, getAdminUserIds } = await import("./admin.js");

    expect(getAdminUserIds().size).toBe(0);
    expect(isAdmin("anyone")).toBe(false);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("ADMIN_USER_IDS env var is empty or unset")
    );

    warnSpy.mockRestore();
  });

  it("ignores empty segments from trailing commas", async () => {
    process.env.ADMIN_USER_IDS = "user1,,user2,";
    const { getAdminUserIds } = await import("./admin.js");

    expect(getAdminUserIds().size).toBe(2);
  });

  it("handles whitespace-only env var as empty", async () => {
    process.env.ADMIN_USER_IDS = "   ";
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { getAdminUserIds } = await import("./admin.js");

    expect(getAdminUserIds().size).toBe(0);
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });
});
