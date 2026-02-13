import dynamic from "next/dynamic";

const Pricing = dynamic(() => import("@/views/Pricing"), {
  loading: () => <div className="min-h-screen bg-background" />,
});

export default function PricingPage() {
  return <Pricing />;
}
