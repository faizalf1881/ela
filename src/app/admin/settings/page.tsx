"use client";

import { StaffShell } from "@/components/staff/StaffShell";
import { ScanWorkflowSettings } from "@/components/staff/ScanWorkflowSettings";

export default function AdminSettingsPage() {
  return (
    <StaffShell allow={["admin"]}>
      <h1 className="font-serif text-3xl text-foreground">Settings</h1>
      <p className="mt-1 text-sm text-muted-foreground">How the kitchen works day to day.</p>
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <ScanWorkflowSettings />
      </div>
    </StaffShell>
  );
}
