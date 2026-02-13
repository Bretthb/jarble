import dynamic from "next/dynamic";

const About = dynamic(() => import("@/views/About"), {
  loading: () => <div className="min-h-screen bg-background" />,
});

export default function AboutPage() {
  return <About />;
}
