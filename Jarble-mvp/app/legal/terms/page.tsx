import type { Metadata } from "next";
import Terms from "@/views/Terms";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "Terms of Service for the Jarble platform.",
};

// JAR-TOS: /legal/terms is the canonical consent-flow link. It re-exports
// the same Terms view used by /terms so there is a single source of
// truth. The ConsentGate links here (not to /terms) so the consent audit
// trail is easy to trace when we eventually ship versioned terms.
export default function LegalTermsPage() {
  return <Terms />;
}
