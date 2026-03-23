import type { Metadata } from "next";
import Terms from "@/views/Terms";

export const metadata: Metadata = {
  title: "Terms of Service",
};

export default function TermsPage() {
  return <Terms />;
}
