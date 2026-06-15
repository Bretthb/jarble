import dynamic from "next/dynamic";

const Research = dynamic(() => import("@/views/Research"), {
  loading: () => <div className="min-h-screen bg-background" />,
});

export default function ResearchPage() {
  return <Research />;
}
