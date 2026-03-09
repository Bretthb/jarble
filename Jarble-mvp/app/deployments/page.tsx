"use client";

// TODO: Re-enable for post-MVP — Linked Deployments graph view
// import dynamic from "next/dynamic";
// const Deployments = dynamic(() => import("@/views/Deployments"), {
//   ssr: false,
//   loading: () => (
//     <div className="min-h-screen bg-background flex items-center justify-center">
//       <div className="w-8 h-8 animate-spin mx-auto border-2 border-primary border-t-transparent rounded-full" />
//     </div>
//   ),
// });

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function DeploymentsPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/dashboard");
  }, [router]);
  return null;
}
