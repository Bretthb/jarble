"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Auth0 handles registration through the login flow
// Redirect to login page
export default function RegisterPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/login");
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <p className="text-muted-foreground">Redirecting to login...</p>
    </div>
  );
}
