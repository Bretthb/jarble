"use client";

import dynamic from "next/dynamic";

const Deployments = dynamic(() => import("@/views/Deployments"), {
  ssr: false,
  loading: () => (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="w-8 h-8 animate-spin mx-auto border-2 border-primary border-t-transparent rounded-full" />
    </div>
  ),
});

export default function DeploymentsPage() {
  return <Deployments />;
}
