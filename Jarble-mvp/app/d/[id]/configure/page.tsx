"use client";

import { useParams, redirect } from "next/navigation";

export default function DeploymentConfigurePage() {
  const { id } = useParams() as { id: string };
  redirect(`/d/${id}`);
}
