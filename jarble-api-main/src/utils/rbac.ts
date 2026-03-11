export type UserRole = "user" | "super_admin";

export function isAdmin(user: { role?: string }): boolean {
  return user.role === "super_admin";
}
