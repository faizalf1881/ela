import { NewOrderAlerts } from "@/components/staff/NewOrderAlerts";

/** Keeps the new-order alert alive while admins move between admin pages. */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <NewOrderAlerts boardHref="/admin" />
    </>
  );
}
