"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/layout/app-shell";
import { RunInvestigationButton } from "@/components/run-investigation-button";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { TableSkeleton } from "@/components/ui/table-skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useCachedJson } from "@/hooks/use-cached-json";
import { formatCurrency } from "@/lib/utils";

type Order = {
  id: string;
  orderNumber: string;
  orderStatus: string;
  productionStatus: string;
  shippingStatus: string;
  trackingNumber: string | null;
  orderValue: number;
  issueType: string | null;
  expectedDeliveryDate: string;
  customer: { name: string; email: string };
};

const selectOrders = (json: unknown) =>
  ((json as { orders?: Order[] }).orders || []) as Order[];

export function OrdersClient({ initialOrders }: { initialOrders?: Order[] } = {}) {
  const { data: baseOrders = [], loading } = useCachedJson(
    "orders:list",
    "/api/orders",
    selectOrders,
    initialOrders,
  );
  const [orders, setOrders] = useState<Order[]>(initialOrders ?? baseOrders);
  const [q, setQ] = useState("");

  useEffect(() => {
    if (!q) setOrders(baseOrders);
  }, [baseOrders, q]);

  useEffect(() => {
    if (!q) return;
    const t = setTimeout(() => {
      fetch(`/api/orders?q=${encodeURIComponent(q)}`)
        .then((r) => r.json())
        .then((d) => setOrders(d.orders || []));
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <AppShell
      title="Orders"
      description="Demo order catalog with realistic operational problem scenarios."
      actions={<RunInvestigationButton />}
    >
      <div className="mb-4 max-w-sm">
        <Input
          placeholder="Search orders, customers..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      <Card className="border-0">
        <CardContent className="pt-6">
          {loading && orders.length === 0 ? (
            <TableSkeleton rows={8} cols={6} />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Production</TableHead>
                  <TableHead>Shipping</TableHead>
                  <TableHead>Issue</TableHead>
                  <TableHead>Value</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.map((o) => (
                  <TableRow key={o.id}>
                    <TableCell className="font-medium">
                      <Link
                        href={`/orders/${o.orderNumber}`}
                        className="text-blue-700 hover:underline"
                      >
                        {o.orderNumber}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <div>{o.customer.name}</div>
                      <div className="text-xs text-slate-400">{o.customer.email}</div>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={o.orderStatus} />
                    </TableCell>
                    <TableCell className="capitalize">
                      {o.productionStatus.replaceAll("_", " ")}
                    </TableCell>
                    <TableCell className="capitalize">
                      {o.shippingStatus.replaceAll("_", " ")}
                    </TableCell>
                    <TableCell className="capitalize text-xs">
                      {(o.issueType || "—").replaceAll("_", " ")}
                    </TableCell>
                    <TableCell>{formatCurrency(o.orderValue)}</TableCell>
                    <TableCell>
                      <RunInvestigationButton defaultOrderNumber={o.orderNumber} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}
