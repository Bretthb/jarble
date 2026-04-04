import dynamic from "next/dynamic";

const Home = dynamic(() => import("@/views/Home"), {
  loading: () => <div className="min-h-screen bg-background" />,
});

export default function HomePage() {
  return <Home />;
}
// Preview deploy test - Sat Apr  4 15:16:59 EDT 2026
