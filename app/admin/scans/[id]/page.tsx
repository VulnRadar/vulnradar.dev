import { ScanInspector } from "@/components/admin/scans/scan-inspector";

export default async function AdminScanPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ScanInspector id={id} />;
}
