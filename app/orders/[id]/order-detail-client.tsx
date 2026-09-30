"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { RunInvestigationButton } from "@/components/run-investigation-button";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/utils";

export type OrderDetail = {
  orderNumber: string;
  orderStatus: string;
  productionStatus: string;
  shippingStatus: string;
  trackingNumber: string | null;
  shippingCarrier: string | null;
  shippingAddress: string;
  orderValue: number;
  customerNotes: string | null;
  expectedDeliveryDate: string;
  customer: { name: string; email: string; externalId: string };
  productionRecords: Array<{
    stage: string;
    delayReported: boolean;
    delayReason: string | null;
    estimatedCompletionAt: string | null;
  }>;
  shipmentEvents: Array<{
    eventLabel: string;
    status: string;
    location: string | null;
    eventAt: string;
  }>;
  supportTickets: Array<{
    id: string;
    category: string;
    description: string;
    priority: string;
    status: string;
    createdBy: string;
    createdAt: string;
  }>;
};

export function OrderDetailClient({ initialOrder }: { initialOrder: OrderDetail }) {
  const [order, setOrder] = useState(initialOrder);

  useEffect(() => {
    setOrder(initialOrder);
  }, [initialOrder]);

  return (
    <AppShell
      title={order.orderNumber}
      description="Demo order detail including simulated production, shipping, and support tickets."
      actions={<RunInvestigationButton defaultOrderNumber={order.orderNumber} />}
    >
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border-slate-200 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">Order</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex items-center gap-2">
              Status <StatusBadge status={order.orderStatus} />
            </div>
            <div>Value: {formatCurrency(order.orderValue)}</div>
            <div>Expected delivery: {formatDate(order.expectedDeliveryDate)}</div>
            <div>Address: {order.shippingAddress}</div>
            <div>Notes: {order.customerNotes || "—"}</div>
            <div>
              Customer: {order.customer.name} ({order.customer.externalId})
            </div>
            <div className="text-slate-500">{order.customer.email}</div>
          </CardContent>
        </Card>

        <Card className="border-slate-200 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">
              Production <span className="text-xs font-normal text-amber-700">(simulated)</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div>Status: {order.productionStatus}</div>
            {order.productionRecords.map((p, i) => (
              <div key={i} className="rounded border border-slate-100 p-2">
                <div>Stage: {p.stage}</div>
                <div>Delay: {p.delayReported ? p.delayReason || "Yes" : "No"}</div>
                <div>ETA: {formatDateTime(p.estimatedCompletionAt)}</div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="border-slate-200 shadow-sm lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">
              Shipping{" "}
              <span className="text-xs font-normal text-amber-700">(simulated carrier)</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div>
              {order.shippingCarrier || "—"} · {order.trackingNumber || "No tracking number"} ·{" "}
              {order.shippingStatus}
            </div>
            {order.shipmentEvents.length === 0 ? (
              <p className="text-slate-500">No tracking events.</p>
            ) : (
              order.shipmentEvents.map((e, i) => (
                <div key={i} className="rounded border border-slate-100 px-3 py-2">
                  <div className="font-medium">{e.eventLabel}</div>
                  <div className="text-xs text-slate-500">
                    {e.status} · {e.location} · {formatDateTime(e.eventAt)}
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card className="border-slate-200 shadow-sm lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Support tickets</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {(order.supportTickets || []).length === 0 ? (
              <p className="text-slate-500">No support tickets for this order.</p>
            ) : (
              (order.supportTickets || []).map((t) => (
                <div key={t.id} className="rounded border border-slate-100 px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={t.status} />
                    <span className="capitalize">{t.category.replaceAll("_", " ")}</span>
                    <span className="text-xs uppercase text-slate-400">{t.priority}</span>
                    <span className="text-xs text-slate-400">by {t.createdBy}</span>
                  </div>
                  <p className="mt-1 text-slate-700">{t.description}</p>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
