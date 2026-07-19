"use client";

import { StaffShell } from "@/components/staff/StaffShell";
import { StaffManager } from "@/components/staff/StaffManager";

export default function AdminStaffPage() {
  return (
    <StaffShell allow={["admin"]}>
      <StaffManager />
    </StaffShell>
  );
}
