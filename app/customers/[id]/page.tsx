"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { AppShell } from "@/components/layout/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function CustomerDetailPage() {
  const params = useParams<{ id: string }>();
  const [customer, setCustomer] = useState<{
    externalId: string;
    name: string;
    email: string;
    notes: string | null;
    orders: Array<{ orderNumber: string; orderStatus: string; orderDate: string }>;
    supportHistory: Array<{ subject: string; summary: string; createdAt: string }>;
  } | null>(null);

  useEffect(() => {
    fetch(`/api/customers/${params.id}`)
      .then((r) => r.json())
      .then((d) => setCustomer(d.customer));
  }, [params.id]);

  return (
    <AppShell title={customer?.name || "Customer"} description={customer?.email}>
      {!customer ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="border-slate-200 shadow-sm">
            <CardHeader>
              <CardTitle className="text-base">Profile</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div>ID: {customer.externalId}</div>
              <div>Notes: {customer.notes || "—"}</div>
            </CardContent>
          </Card>
          <Card className="border-slate-200 shadow-sm">
            <CardHeader>
              <CardTitle className="text-base">Orders</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {customer.orders.map((o) => (
                <Link
                  key={o.orderNumber}
                  href={`/orders/${o.orderNumber}`}
                  className="block rounded border border-slate-100 px-3 py-2 hover:bg-slate-50"
                >
                  {o.orderNumber} · {o.orderStatus}
                </Link>
              ))}
            </CardContent>
          </Card>
          <Card className="border-slate-200 shadow-sm lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-base">Support history</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {customer.supportHistory.map((s, i) => (
                <div key={i} className="rounded border border-slate-100 px-3 py-2">
                  <div className="font-medium">{s.subject}</div>
                  <div className="text-slate-500">{s.summary}</div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      )}
    </AppShell>
  );
}
