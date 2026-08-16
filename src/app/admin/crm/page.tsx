"use client";

import { StaffShell } from "@/components/staff/StaffShell";
import { CrmBoard } from "@/components/staff/CrmBoard";

export default function AdminCrmPage() {
  return (
    <StaffShell allow={["admin"]}>
      <CrmBoard />
    </StaffShell>
  );
}
