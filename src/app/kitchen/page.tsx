"use client";

import { StaffShell } from "@/components/staff/StaffShell";
import { OrdersBoard } from "@/components/staff/OrdersBoard";

export default function KitchenPage() {
  return (
    <StaffShell allow={["kitchen", "admin"]}>
      <OrdersBoard />
    </StaffShell>
  );
}
