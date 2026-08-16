"use client";

import { StaffShell } from "@/components/staff/StaffShell";
import { ComplaintsBoard } from "@/components/staff/ComplaintsBoard";

export default function AdminComplaintsPage() {
  return (
    <StaffShell allow={["admin"]}>
      <ComplaintsBoard />
    </StaffShell>
  );
}
