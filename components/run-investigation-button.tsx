"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type OrderOption = { orderNumber: string; issueType: string | null };

export function RunInvestigationButton({
  defaultOrderNumber,
}: {
  defaultOrderNumber?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [orders, setOrders] = useState<OrderOption[]>([]);
  const [orderId, setOrderId] = useState(defaultOrderNumber || "");
  const [prompt, setPrompt] = useState(
    defaultOrderNumber
      ? `Investigate why order ${defaultOrderNumber} has not been delivered and determine what should happen next.`
      : "",
  );
  const [loading, setLoading] = useState(false);

  // Load orders only when the dialog opens — avoids a 3–5s /api/orders hit on every page.
  useEffect(() => {
    if (!open || orders.length > 0) return;
    fetch("/api/orders")
      .then((r) => r.json())
      .then((data) => setOrders(data.orders || []))
      .catch(() => undefined);
  }, [open, orders.length]);

  async function onSubmit() {
    if (!prompt.trim()) {
      toast.error("Enter an investigation prompt.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: orderId || null, prompt }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to start");
      toast.success("Investigation started");
      setOpen(false);
      router.push(`/tasks/${data.task.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to start investigation");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button className="h-9 gap-2 rounded-full bg-blue-600 px-4 text-white shadow-lg shadow-blue-600/25 hover:bg-blue-700" />
        }
      >
        <Search className="h-4 w-4" />
        Run Investigation
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Run Investigation</DialogTitle>
          <DialogDescription>
            Start the Order Operations Agent. It will call real application tools against
            the demo database (simulated shipping/production/email integrations).
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="order">Order</Label>
            <select
              id="order"
              className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm"
              value={orderId}
              onChange={(e) => {
                const v = e.target.value;
                setOrderId(v);
                if (v) {
                  setPrompt(
                    `Investigate why order ${v} has not been delivered and determine what should happen next.`,
                  );
                }
              }}
            >
              <option value="">Select an order</option>
              {orders.map((o) => (
                <option key={o.orderNumber} value={o.orderNumber}>
                  {o.orderNumber}
                  {o.issueType ? ` · ${o.issueType}` : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="prompt">Task prompt</Label>
            <Textarea
              id="prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={5}
              placeholder="Describe what the agent should investigate..."
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            onClick={onSubmit}
            disabled={loading}
            className="bg-blue-600 text-white hover:bg-blue-700"
          >
            {loading ? "Starting..." : "Start agent"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
