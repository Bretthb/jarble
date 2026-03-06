"use client";

import { useParams } from "next/navigation";
import { ServiceDetail } from "@/components/marketplace/ServiceDetail";

export default function ServiceDetailPage() {
  const params = useParams();
  const id = params.id as string;

  return <ServiceDetail serviceId={id} />;
}
