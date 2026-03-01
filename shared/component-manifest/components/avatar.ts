import type { ComponentManifestEntry } from "../types.js";

export const avatarEntry: ComponentManifestEntry = {
  name: "avatar",
  description: "User avatar with image or initials fallback",
  reference: "`{name, src?, subtitle?, size?: \"sm\"|\"md\"|\"lg\"}`",
  category: "display",
  layout: { defaultHint: "compact", defaultSize: { w: 200, h: 80 } },
  loading: "static",
  expensive: false,
  aliases: ["user", "profile_pic"],
  tags: ["user", "avatar", "profile"],
  builtin: true,
  renderOrder: 8,
};
