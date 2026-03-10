import dynamic from "next/dynamic";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service | Jarble",
};

const Terms = dynamic(() => import("@/views/Terms"), {
  loading: () => <div className="min-h-screen bg-background" />,
});

export default function TermsPage() {
  return <Terms />;
}
