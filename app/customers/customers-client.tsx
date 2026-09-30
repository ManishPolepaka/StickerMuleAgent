"use client";

import Link from "next/link";
import { AppShell } from "@/components/layout/app-shell";
import { Card, CardContent } from "@/components/ui/card";
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

type Customer = {
  id: string;
  externalId: string;
  name: string;
  email: string;
  notes: string | null;
  _count: { orders: number; supportHistory: number };
};

const selectCustomers = (json: unknown) =>
  ((json as { customers?: Customer[] }).customers || []) as Customer[];

export function CustomersClient({
  initialCustomers,
}: { initialCustomers?: Customer[] } = {}) {
  const { data: customers = [], loading } = useCachedJson(
    "customers:list",
    "/api/customers",
    selectCustomers,
    initialCustomers,
  );

  return (
    <AppShell
      title="Customers"
      description="Demo customers with order and support history used by the agent."
    >
      <Card className="border-0">
        <CardContent className="pt-6">
          {loading && customers.length === 0 ? (
            <TableSkeleton rows={8} cols={5} />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Orders</TableHead>
                  <TableHead>Support history</TableHead>
                  <TableHead>Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {customers.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>
                      <Link href={`/customers/${c.id}`} className="text-blue-700 hover:underline">
                        {c.externalId}
                      </Link>
                    </TableCell>
                    <TableCell className="font-medium">{c.name}</TableCell>
                    <TableCell>{c.email}</TableCell>
                    <TableCell>{c._count.orders}</TableCell>
                    <TableCell>{c._count.supportHistory}</TableCell>
                    <TableCell className="max-w-xs truncate text-sm text-slate-500">
                      {c.notes || "—"}
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
