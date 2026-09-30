import { notFound } from "next/navigation";
import { OrderDetailClient, type OrderDetail } from "@/app/orders/[id]/order-detail-client";
import { getOrderDetail } from "@/lib/services/order-detail";

export const dynamic = "force-dynamic";

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const order = await getOrderDetail(id);
  if (!order) notFound();
  return <OrderDetailClient initialOrder={order as OrderDetail} />;
}
