/**
 * Browser helpers for the payment gateways' hosted checkouts (checkout page
 * and the /pay link page). Nothing here decides that an order is paid — the
 * server always confirms with the gateway afterwards.
 */

export type RazorpayResponse = {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
};

export type CashfreeCheckoutResult = {
  error?: { message?: string };
  redirect?: boolean;
  paymentDetails?: { paymentMessage?: string };
};

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open: () => void; on: (e: string, cb: (r: unknown) => void) => void };
    Cashfree?: (opts: { mode: "sandbox" | "production" }) => {
      checkout: (opts: { paymentSessionId: string; redirectTarget?: "_self" | "_blank" | "_top" | "_modal" }) => Promise<CashfreeCheckoutResult>;
    };
  }
}

function loadScript(src: string, ready: () => boolean): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof window === "undefined") return resolve(false);
    if (ready()) return resolve(true);
    const script = document.createElement("script");
    script.src = src;
    script.onload = () => resolve(ready());
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
}

export function loadRazorpay(): Promise<boolean> {
  return loadScript("https://checkout.razorpay.com/v1/checkout.js", () => !!window.Razorpay);
}

export function loadCashfree(): Promise<boolean> {
  return loadScript("https://sdk.cashfree.com/js/v3/cashfree.js", () => !!window.Cashfree);
}

/**
 * Opens Cashfree's checkout in a pop-up. Resolves when it closes, whatever
 * happened; `redirect` means the browser is being sent to the return page
 * instead (some in-app browsers), so the caller should just wait.
 */
export async function cashfreeCheckout(paymentSessionId: string, mode: "sandbox" | "production"): Promise<CashfreeCheckoutResult> {
  const ok = await loadCashfree();
  if (!ok || !window.Cashfree) throw new Error("Could not load the payment page. Check your connection and try again.");
  return window.Cashfree({ mode }).checkout({ paymentSessionId, redirectTarget: "_modal" });
}
