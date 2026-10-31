/** Shared by the campaign list and the campaign screen. */
export const STATUS_PILL: Record<string, string> = {
  DRAFT: "bg-muted text-muted-foreground",
  SENDING: "bg-blue-500/10 text-blue-700",
  COMPLETED: "bg-green-500/15 text-green-700",
  CANCELLED: "bg-destructive/10 text-destructive",
};

const LIMITS: Record<string, string> = { TIER_250: "250", TIER_1K: "1,000", TIER_2K: "2,000", TIER_10K: "10,000", TIER_100K: "100,000", TIER_UNLIMITED: "Unlimited" };

/** WhatsApp's daily limit for starting conversations, in words. */
export const limitText = (l?: string) => (l ? (LIMITS[l] ?? l.replace("TIER_", "")) : null);
