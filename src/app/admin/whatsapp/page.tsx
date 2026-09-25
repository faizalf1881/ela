"use client";

import { Suspense } from "react";
import { StaffShell } from "@/components/staff/StaffShell";
import { WhatsAppInbox } from "@/components/staff/WhatsAppInbox";

export default function AdminWhatsAppPage() {
  return (
    <StaffShell allow={["admin"]}>
      {/* useSearchParams (open a chat from a customer profile) needs a Suspense boundary. */}
      <Suspense>
        <WhatsAppInbox />
      </Suspense>
    </StaffShell>
  );
}
