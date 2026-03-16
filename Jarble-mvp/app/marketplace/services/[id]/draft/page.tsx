"use client";

import { useParams } from "next/navigation";
import DraftServiceDetail from "@/components/marketplace/DraftServiceDetail";

export default function DraftServicePage() {
  const params = useParams();
  const serviceId = params.id as string;
  return <DraftServiceDetail serviceId={serviceId} />;
}
