"use client";

import { StaffShell } from "@/components/staff/StaffShell";
import { NotificationLog } from "@/components/staff/NotificationLog";

export default function AdminNotificationsPage() {
  return (
    <StaffShell allow={["admin"]}>
      <NotificationLog />
    </StaffShell>
  );
}
