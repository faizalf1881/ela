import "server-only";
import crypto from "node:crypto";

/**
 * Encrypts secrets stored in the database (e.g. the OpenAI API key entered in
 * the admin panel) with AES-256-GCM. The key is derived from
 * SETTINGS_ENCRYPTION_KEY, falling back to JWT_SECRET, so a copy of the
 * database alone does not reveal it. Changing that secret makes stored values
 * unreadable — they must then be entered again.
 */
function key(): Buffer {
  const secret = process.env.SETTINGS_ENCRYPTION_KEY || process.env.JWT_SECRET;
  if (!secret || secret.length < 16) throw new Error("SETTINGS_ENCRYPTION_KEY (or JWT_SECRET) must be set to store secrets.");
  return Buffer.from(crypto.hkdfSync("sha256", secret, "ela-settings", "secret-box-v1", 32));
}

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `v1:${Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64")}`;
}

/** Null when the value cannot be decrypted (tampered, or the secret changed). */
export function decryptSecret(stored: string | null | undefined): string | null {
  if (!stored?.startsWith("v1:")) return null;
  try {
    const raw = Buffer.from(stored.slice(3), "base64");
    const decipher = crypto.createDecipheriv("aes-256-gcm", key(), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/** "sk-proj-…40A" — enough to recognise a key, useless to anyone else. */
export function secretHint(plain: string): string {
  const p = plain.trim();
  return p.length <= 10 ? "••••" : `${p.slice(0, 7)}…${p.slice(-4)}`;
}
