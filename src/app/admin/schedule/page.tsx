"use client";

import { StaffShell } from "@/components/staff/StaffShell";
import { DeliverySchedule } from "@/components/staff/DeliverySchedule";

export default function AdminSchedulePage() {
  return (
    <StaffShell allow={["admin"]}>
      <DeliverySchedule />
    </StaffShell>
  );
}
