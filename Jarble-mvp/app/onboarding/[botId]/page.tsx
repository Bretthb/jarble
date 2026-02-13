import dynamic from "next/dynamic";

const OnboardingWizard = dynamic(() => import("@/views/OnboardingWizard"), {
  loading: () => <div className="min-h-screen bg-background" />,
});

export default function OnboardingPage() {
  return <OnboardingWizard />;
}
