import Image from "next/image";

/** Source artwork for the round Ela & Co. emblem (transparent, 512×512). */
export const LOGO_SRC = "/brand/ela-logo.png";

/**
 * The Ela & Co. emblem. Served through next/image so each placement gets a
 * right-sized WebP/AVIF instead of the full artwork, and never stretched: the
 * emblem is square and always rendered square with `object-contain`.
 */
export function BrandLogo({ size = 40, className = "", priority = false }: { size?: number; className?: string; priority?: boolean }) {
  return (
    <Image
      src={LOGO_SRC}
      alt="Ela & Co."
      width={size}
      height={size}
      priority={priority}
      className={`shrink-0 object-contain ${className}`}
      style={{ width: size, height: size }}
    />
  );
}
