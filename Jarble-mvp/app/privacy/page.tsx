import dynamic from "next/dynamic";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy",
};

const Privacy = dynamic(() => import("@/views/Privacy"), {
  loading: () => <div className="min-h-screen bg-background" />,
});

export default function PrivacyPage() {
  return <Privacy />;
}
