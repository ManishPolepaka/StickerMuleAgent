import { OverviewClient } from "@/app/overview-client";

/** Client-first: paints instantly from browser cache; no SSR wait on nav. */
export default function OverviewPage() {
  return <OverviewClient />;
}
