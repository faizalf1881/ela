import "server-only";
import QRCode from "qrcode";

/**
 * Render `text` as a self-contained QR SVG string (no external assets, safe to
 * inline into a printed page). Used for kitchen delivery labels, where the QR
 * encodes the order id so staff can scan to pull the order up.
 */
export async function qrSvg(text: string, sizePx = 150): Promise<string> {
  return QRCode.toString(text, {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 1,
    width: sizePx,
    color: { dark: "#000000", light: "#ffffff" },
  });
}
