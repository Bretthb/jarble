"use client";

import { useParams } from "next/navigation";
import { PackageDetail } from "@/components/marketplace/PackageDetail";

export default function PackageDetailPage() {
  const params = useParams();
  const id = params.id as string;

  return <PackageDetail packageId={id} />;
}
