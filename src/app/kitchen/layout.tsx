import { NewOrderAlerts } from "@/components/staff/NewOrderAlerts";

/** Kitchen board: same new-order alert as the admin panel. */
export default function KitchenLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <NewOrderAlerts boardHref="/kitchen" />
    </>
  );
}
