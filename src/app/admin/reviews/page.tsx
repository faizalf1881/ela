"use client";

import { StaffShell } from "@/components/staff/StaffShell";
import { ReviewManager } from "@/components/staff/ReviewManager";

export default function AdminReviewsPage() {
  return (
    <StaffShell allow={["admin"]}>
      <ReviewManager />
    </StaffShell>
  );
}
