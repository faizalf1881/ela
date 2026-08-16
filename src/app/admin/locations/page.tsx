"use client";

import { StaffShell } from "@/components/staff/StaffShell";
import { LocationManager } from "@/components/staff/LocationManager";

export default function AdminLocationsPage() {
  return (
    <StaffShell allow={["admin"]}>
      <LocationManager />
    </StaffShell>
  );
}
