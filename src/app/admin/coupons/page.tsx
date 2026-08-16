"use client";

import { StaffShell } from "@/components/staff/StaffShell";
import { CouponManager } from "@/components/staff/CouponManager";

export default function AdminCouponsPage() {
  return (
    <StaffShell allow={["admin"]}>
      <CouponManager />
    </StaffShell>
  );
}
