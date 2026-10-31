"use client";

import { Suspense } from "react";
import { StaffShell } from "@/components/staff/StaffShell";
import { CampaignsBoard } from "@/components/staff/CampaignsBoard";

export default function AdminCampaignsPage() {
  return (
    <StaffShell allow={["admin"]}>
      <Suspense>
        <CampaignsBoard />
      </Suspense>
    </StaffShell>
  );
}
