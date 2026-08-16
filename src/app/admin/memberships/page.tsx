"use client";

import { StaffShell } from "@/components/staff/StaffShell";
import { PlanManager } from "@/components/staff/PlanManager";

export default function AdminMembershipsPage() {
  return (
    <StaffShell allow={["admin"]}>
      <PlanManager />
    </StaffShell>
  );
}
