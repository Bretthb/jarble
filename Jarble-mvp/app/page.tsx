import dynamic from "next/dynamic";

const Home = dynamic(() => import("@/views/Home"), {
  loading: () => <div className="min-h-screen bg-background" />,
});

export default function HomePage() {
  return <Home />;
}
