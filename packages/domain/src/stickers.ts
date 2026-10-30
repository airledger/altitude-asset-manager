// QR sticker IDs. Format: specs/05-integrations.md ("QR stickers").

/** Letters and digits that can't be confused with each other (no I, O, 0 or 1). */
export const STICKER_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const STICKER_RE = /^AC-[A-Z0-9]{5}$/;

/** A new random sticker ID, "AC-XXXXX". The rebuild reserves these on the server so they're unique. */
export function newStickerId(
  random: (n: number) => Uint32Array = (n) => crypto.getRandomValues(new Uint32Array(n)),
): string {
  return "AC-" + Array.from(random(5), (x) => STICKER_ALPHABET[x % STICKER_ALPHABET.length]).join("");
}

/**
 * The sticker ID in a scanned QR code or typed text. Reads every format printed so far: app links
 * (`…#u-AC-XXXXX`, including old claude.ai links), a bare `AC-XXXXX` and `ACXXXXX`.
 */
export function parseScan(text: string | null | undefined): string | null {
  const t = String(text || "").trim();
  const link = t.match(/#u-([A-Za-z0-9-]+)/);
  if (link?.[1]) return link[1].toUpperCase();
  const bare = t.match(/\bAC-?([A-Z0-9]{5})\b/i);
  if (bare?.[1]) return "AC-" + bare[1].toUpperCase();
  return null;
}
