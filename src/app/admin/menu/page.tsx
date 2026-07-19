"use client";

import { StaffShell } from "@/components/staff/StaffShell";
import { MenuManager } from "@/components/staff/MenuManager";

export default function AdminMenuPage() {
  return (
    <StaffShell allow={["admin"]}>
      <MenuManager />
    </StaffShell>
  );
}
