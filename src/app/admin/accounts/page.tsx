"use client";

import { StaffShell } from "@/components/staff/StaffShell";
import { AccountsBoard } from "@/components/staff/AccountsBoard";

export default function AdminAccountsPage() {
  return (
    <StaffShell allow={["admin"]}>
      <AccountsBoard />
    </StaffShell>
  );
}
