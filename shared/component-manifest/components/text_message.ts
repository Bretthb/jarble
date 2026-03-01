import type { ComponentManifestEntry } from "../types.js";

export const textMessageEntry: ComponentManifestEntry = {
  name: "text_message",
  description: "Chat-style message bubble",
  reference: "`{botText, userText?}`",
  category: "display",
  layout: { defaultHint: "third", defaultSize: { w: 360, h: 240 } },
  loading: "static",
  expensive: false,
  aliases: ["chat_bubble", "message"],
  tags: ["chat", "message", "conversation"],
  builtin: true,
  renderOrder: 7,
};
