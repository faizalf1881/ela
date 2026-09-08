"use client";

import { StaffShell } from "@/components/staff/StaffShell";
import { OrdersBoard } from "@/components/staff/OrdersBoard";
import { StoreToggle } from "@/components/staff/StoreToggle";
import { CodSettings } from "@/components/staff/CodSettings";

export default function AdminOrdersPage() {
  return (
    <StaffShell allow={["admin"]}>
      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <StoreToggle />
        <CodSettings />
      </div>
      <OrdersBoard showStats />
    </StaffShell>
  );
}
