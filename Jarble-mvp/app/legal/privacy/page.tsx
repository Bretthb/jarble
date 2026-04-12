import type { Metadata } from "next";
import Privacy from "@/views/Privacy";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "Privacy Policy for the Jarble platform.",
};

// JAR-TOS: /legal/privacy is the canonical consent-flow link. It
// re-exports the same Privacy view used by /privacy so there is a
// single source of truth.
export default function LegalPrivacyPage() {
  return <Privacy />;
}
