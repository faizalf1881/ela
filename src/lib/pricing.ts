/** Effective (discounted) unit price in whole rupees. Shared client + server. */
export function effectivePrice(price: number, discountPercent = 0): number {
  const d = Math.max(0, Math.min(90, Math.round(discountPercent || 0)));
  return Math.round((price * (100 - d)) / 100);
}
