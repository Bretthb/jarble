"use client";
import AdminUserDetail from "@/views/admin/AdminUserDetail";
export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return <AdminUserDetail params={params} />;
}
