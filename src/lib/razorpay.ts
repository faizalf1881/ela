import "server-only";
import Razorpay from "razorpay";
import crypto from "node:crypto";

let client: Razorpay | null = null;

export function razorpay(): Razorpay {
  const key_id = process.env.RAZORPAY_KEY_ID;
  const key_secret = process.env.RAZORPAY_KEY_SECRET;
  if (!key_id || !key_secret) {
    throw new Error("Razorpay keys missing. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in .env");
  }
  if (!client) client = new Razorpay({ key_id, key_secret });
  return client;
}

/**
 * Verifies HMAC-SHA256(order_id | payment_id, KEY_SECRET) against the signature
 * Razorpay returns on success. Uses a timing-safe comparison.
 */
export function verifyPaymentSignature(params: {
  orderId: string;
  paymentId: string;
  signature: string;
}): boolean {
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!secret) throw new Error("RAZORPAY_KEY_SECRET missing");

  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${params.orderId}|${params.paymentId}`)
    .digest("hex");

  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(params.signature || "", "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
