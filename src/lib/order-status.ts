export type OrderStatus =
  | "PENDING"
  | "PLACED"
  | "PREPARING"
  | "OUT_FOR_DELIVERY"
  | "DELIVERED"
  | "CANCELLED";

export const STATUS_LABEL: Record<OrderStatus, string> = {
  PENDING: "Awaiting payment",
  PLACED: "Order confirmed",
  PREPARING: "Preparing",
  OUT_FOR_DELIVERY: "On the way",
  DELIVERED: "Delivered",
  CANCELLED: "Cancelled",
};

export const STATUS_BADGE: Record<OrderStatus, string> = {
  PENDING: "bg-muted text-muted-foreground",
  PLACED: "bg-forest/10 text-forest",
  PREPARING: "bg-gold/15 text-[oklch(0.52_0.12_75)]",
  OUT_FOR_DELIVERY: "bg-blue-500/10 text-blue-600",
  DELIVERED: "bg-green-500/15 text-green-700",
  CANCELLED: "bg-destructive/10 text-destructive",
};

/** Statuses kitchen/admin can move an order through (excludes pre-payment PENDING). */
export const KITCHEN_STATUSES: OrderStatus[] = [
  "PLACED",
  "PREPARING",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
  "CANCELLED",
];

export type OrderItemDTO = { id: string; menuItemId: string | null; name: string; mrp: number; price: number; qty: number };

/** Ordered fulfillment steps shown in the customer tracker. */
export const TRACK_STEPS: OrderStatus[] = ["PLACED", "PREPARING", "OUT_FOR_DELIVERY", "DELIVERED"];
export type OrderDTO = {
  id: string;
  invoiceNo: string | null;
  customerName: string;
  customerPhone: string;
  address: string;
  notes: string | null;
  items: OrderItemDTO[];
  subtotal: number;
  discountTotal: number;
  deliveryFee: number;
  total: number;
  status: OrderStatus;
  paymentMethod: string;
  paymentStatus: "UNPAID" | "PAID" | "FAILED";
  createdAt: string;
};
