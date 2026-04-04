import dynamic from "next/dynamic";

const Home = dynamic(() => import("@/views/Home"), {
  loading: () => <div className="min-h-screen bg-background" />,
});

export default function HomePage() {
  return <Home />;
}
// Coolify preview test - Sat Apr  4 17:24:09 EDT 2026
