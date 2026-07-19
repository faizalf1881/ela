"use client";

import { StaffShell } from "@/components/staff/StaffShell";
import { OrdersBoard } from "@/components/staff/OrdersBoard";
import { StoreToggle } from "@/components/staff/StoreToggle";

export default function AdminOrdersPage() {
  return (
    <StaffShell allow={["admin"]}>
      <div className="mb-6">
        <StoreToggle />
      </div>
      <OrdersBoard showStats />
    </StaffShell>
  );
}
