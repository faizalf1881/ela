"use client";

import { StaffShell } from "@/components/staff/StaffShell";
import { WebsiteContentManager } from "@/components/staff/WebsiteContentManager";

export default function AdminWebsitePage() {
  return (
    <StaffShell allow={["admin"]}>
      <WebsiteContentManager />
    </StaffShell>
  );
}
